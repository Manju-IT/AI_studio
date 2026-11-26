"""Atomic queued-job controls. Running jobs are deliberately not interrupted."""
from pathlib import Path
from app.services.jobs.local_queue import load, save
from app.services.jobs.worker_lock import worker_lock


def transition(path: Path, expected: set[str], target: str):
    with worker_lock(path.with_suffix('.lock')) as acquired:
        if not acquired:
            raise ValueError('Job is busy; refresh and retry.')
        data = load(path)
        if data.get('status') not in expected:
            raise ValueError('Job status changed; refresh and retry.')
        if target == 'queued' and data.get('kind') == 'asr':
            if not data.get('source') or not Path(data['source']).is_file():
                raise ValueError('Source audio is unavailable; submit again.')
        data.update(status=target, error=None)
        save(path, data)
        return data
