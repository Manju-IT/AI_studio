"""Disposable ASR process; model caches disappear on exit."""
import json
import sys
from pathlib import Path
from app.services.jobs.worker_lock import worker_lock
from app.core.config import get_settings

def extract_main():
    with worker_lock(get_settings().temp_dir / "heavy_child.lock") as acquired:
        if not acquired: raise RuntimeError("Heavy inference busy")
        from qwen3_tts_mnn.cli import main_extract
        main_extract()
from app.services.jobs.local_queue import load, save

if __name__ == '__main__':
    with worker_lock(get_settings().temp_dir / "heavy_child.lock") as acquired:
        if not acquired: raise RuntimeError("Heavy inference busy")
        path = Path(sys.argv[1])
        data = load(path)
        from app.services.transcription import transcribe
        result = transcribe(Path(data['source']), data['model'], data['requested_language'], data.get('diarization', False), data.get('speakers', 0))
        save(Path(sys.argv[2]), result)
