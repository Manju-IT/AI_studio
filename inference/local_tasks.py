"""Serial auxiliary task dispatch, with process isolation and restart recovery."""
import asyncio
import sys
from pathlib import Path
from app.core.config import get_settings
from app.services.jobs.local_queue import save, read, next_task, recover
from app.services.jobs.worker_lock import worker_lock


async def wait_for_previous_child():
    while True:
        with worker_lock(get_settings().temp_dir / 'auxiliary.lock') as acquired:
            if acquired:
                return
        await asyncio.sleep(2)


async def process_next(manager):
    task = next_task()
    if task is None:
        return False
    kind, path, data = task
    await manager.unload()
    data.update(status='processing', error=None)
    save(path, data)
    proc = None
    try:
        proc = await asyncio.create_subprocess_exec(sys.executable, '-m', 'inference.local_task_child', kind, str(path.resolve()))
        await asyncio.wait_for(proc.wait(), timeout=1200 if kind == 'extract' else 7200)
        data = read(path)
        if proc.returncode or data.get('status') != 'completed':
            raise RuntimeError(f'Auxiliary process exit {proc.returncode}')
    except BaseException as exc:
        if proc is not None and proc.returncode is None:
            proc.kill()
            await proc.wait()
        data = read(path)
        data.update(status='failed', error=f'{type(exc).__name__}: {str(exc)[:200]}')
        save(path, data)
        if isinstance(exc, asyncio.CancelledError):
            raise
    finally:
        if kind == 'asr' and data.get('_cleanup') and data.get('_source'):
            Path(data['_source']).unlink(missing_ok=True)
    return True
