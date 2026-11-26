"""Single-terminal local launcher. Run with the project's Python environment."""
from __future__ import annotations
import argparse
import asyncio
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.error
import webbrowser
from contextlib import ExitStack
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT)]


def port_free(port):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', port))


def reachable(url):
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return response.status < 400
    except urllib.error.HTTPError as exc:
        return 300 <= exc.code < 400
    except OSError:
        return False


async def database_check():
    from sqlalchemy import text
    from app.db.session import engine
    try:
        async with engine.connect() as conn:
            await conn.execute(text('SELECT 1'))
    finally:
        await engine.dispose()


def start(name, command, cwd, env, logs, stack):
    path = logs / (name + '.log')
    stream = stack.enter_context(path.open('ab', buffering=0))
    kwargs = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
    proc = subprocess.Popen(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, **kwargs)
    print(f'{name}: PID {proc.pid}; log: {path}', flush=True)
    return proc


def shutdown(processes):
    # Signal groups, not only their leaders. Windows taskkill is a fallback.
    for name, proc in reversed(processes):
        if proc.poll() is None:
            try:
                if os.name == 'nt':
                    proc.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    os.killpg(proc.pid, signal.SIGTERM)
            except OSError:
                pass
    deadline = time.monotonic() + 15
    for name, proc in reversed(processes):
        try:
            proc.wait(timeout=max(0.1, deadline-time.monotonic()))
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            else:
                try: os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError: pass
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: print(f'WARNING: {name} did not exit; inspect PID {proc.pid}')


def wait_ready(name, url, processes, timeout=120):
    deadline = time.monotonic()+timeout
    while time.monotonic()<deadline:
        check_children(processes)
        if reachable(url):
            print(f'{name} HTTP ready', flush=True)
            return
        time.sleep(1)
    raise RuntimeError(f'{name} did not become ready; inspect logs')


def check_children(processes):
    for name, proc in processes:
        if proc.poll() is not None:
            raise RuntimeError(f'{name} exited with code {proc.returncode}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Preflight only; no services started')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    processes = []
    try:
        from app.core.config import get_settings
        from app.services.jobs.worker_lock import worker_lock
        settings = get_settings()
        node = shutil.which('node')
        next_cli = ROOT / 'frontend/node_modules/next/dist/bin/next'
        if not node or not next_cli.is_file():
            raise RuntimeError('Node or Next.js missing. Install frontend dependencies first.')
        for port in (8000, 3000): port_free(port)
        asyncio.run(asyncio.wait_for(database_check(), timeout=15))
        print('PostgreSQL connectivity: OK (schema not checked)')
        with worker_lock(settings.temp_dir / 'launcher.lock') as acquired:
            if not acquired: raise RuntimeError('Another launcher is active')
            with worker_lock(settings.temp_dir / 'worker.lock') as idle:
                if not idle: raise RuntimeError('Existing inference worker detected; stop it first')
            if args.check:
                print('Preflight passed.'); return 0
            env = os.environ.copy()
            env['PYTHONPATH'] = os.pathsep.join([str(ROOT/'backend'), str(ROOT), env.get('PYTHONPATH','')])
            env['PYTHONUNBUFFERED'] = '1'
            logs = settings.storage_root / 'logs' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            logs.mkdir(parents=True)
            with ExitStack() as stack:
                try:
                    processes.append(('backend', start('backend',[sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000'],ROOT,env,logs,stack)))
                    wait_ready('Backend','http://127.0.0.1:8000/api/health',processes)
                    processes.append(('worker',start('worker',[sys.executable,'-u',str(ROOT/'scripts/run_inference_supervisor.py')],ROOT,env,logs,stack)))
                    processes.append(('frontend',start('frontend',[node,str(next_cli),'dev','--hostname','127.0.0.1','--port','3000'],ROOT/'frontend',env,logs,stack)))
                    wait_ready('Frontend','http://localhost:3000',processes,180)
                    print('Open http://localhost:3000 | Ctrl+C to stop. Worker process started; model readiness is not guaranteed.')
                    if not args.no_browser: webbrowser.open('http://localhost:3000')
                    while True:
                        check_children(processes)
                        heartbeat = settings.temp_dir / 'worker_heartbeat'
                        if not heartbeat.exists() or time.time()-heartbeat.stat().st_mtime > 30:
                            print('WARNING: worker heartbeat missing/stale; inspect worker log.', flush=True)
                        if not reachable('http://127.0.0.1:8000/api/health'):
                            print('WARNING: backend health probe failed.', flush=True)
                        time.sleep(10)
                finally:
                    shutdown(processes)
    except KeyboardInterrupt:
        print('Launcher stopped.'); return 0
    except Exception as exc:
        print(f'Launcher failed: {type(exc).__name__}. Check configuration, ports, database and service logs.', file=sys.stderr)
        if isinstance(exc, RuntimeError): print(str(exc), file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
