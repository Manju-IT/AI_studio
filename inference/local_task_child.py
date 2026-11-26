"""Disposable ASR/extraction process. Invoked only by the inference worker."""
import sys
from pathlib import Path
from app.core.config import get_settings
from app.services.jobs.worker_lock import worker_lock
from app.services.jobs.local_queue import read, save


def main():
    kind, filename = sys.argv[1:]
    path = Path(filename)
    with worker_lock(get_settings().temp_dir / 'auxiliary.lock') as acquired:
        if not acquired:
            raise RuntimeError('Another auxiliary process is active')
        data = read(path)
        if kind == 'extract':
            from app.services.voice_extraction import extract
            extract(data['id'], data['_source'], data['_transcript'], worker_owned=True)
        elif kind == 'asr':
            from app.services.transcription import transcribe
            result = transcribe(Path(data['_source']), data['model'], data['requested_language'], data.get('diarization', False), data.get('speakers', 0))
            data.update(result)
        else:
            raise ValueError('Unknown task')
        data.update(status='completed', error=None)
        save(path, data)


if __name__ == '__main__':
    main()
