"""Single-consumer durable local jobs. Only the inference worker executes jobs."""
import json
import os
import tempfile
from pathlib import Path
from app.core.config import get_settings


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def extraction_path(owner, voice):
    return get_settings().storage_root / 'extraction_jobs' / str(owner) / f'{voice}.json'


def paths():
    root = get_settings().storage_root
    return sorted([*root.glob('extraction_jobs/*/*.json'), *root.glob('transcriptions/*/*.json')], key=lambda p: p.stat().st_mtime)


def pending():
    for path in paths():
        data = load(path)
        if data.get('status') == 'queued':
            return path, data
    return None


def recover():
    for path in paths():
        data = load(path)
        if data.get('status') == 'processing':
            data.update(status='failed', error='Worker interrupted. Submit again to retry.')
            save(path, data)
