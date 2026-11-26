"""Offline audit and reversible quarantine of old unregistered generated audio.
Stop API, worker and frontend before running. No model or reference deletion.
"""
import argparse
import asyncio
import json
import time
import uuid
from pathlib import Path
from sqlalchemy import select
from app.core.config import get_settings
from app.db.session import SessionFactory
from app.models.audio import AudioAsset
from app.services.jobs.worker_lock import worker_lock


def candidates(root, registered, cutoff):
    root = root.resolve()
    for p in root.rglob('*'):
        if p.is_symlink() or not p.is_file() or p.suffix.lower() not in {'.wav','.mp3','.flac','.ogg','.m4a'}:
            continue
        resolved = p.resolve()
        if not resolved.is_relative_to(root) or resolved in registered:
            continue
        if p.stat().st_mtime < cutoff:
            yield p


async def run(args):
    s = get_settings()
    with worker_lock(s.temp_dir/'worker.lock') as free:
        if not free: raise SystemExit('Stop inference supervisor first.')
        with worker_lock(s.temp_dir/'heavy_child.lock') as free:
            if not free: raise SystemExit('Heavy subprocess still running.')
            async with SessionFactory() as session:
                registered = {Path(p).resolve() for p in (await session.scalars(select(AudioAsset.storage_path))).all()}
            root = s.generated_audio_dir.resolve()
            files = list(candidates(root, registered, time.time()-args.days*86400))
            missing = [str(p) for p in registered if not p.is_file()]
            print(json.dumps({'candidates':[{'path':str(p),'bytes':p.stat().st_size} for p in files], 'missing_registered_files':missing,'total_bytes':sum(p.stat().st_size for p in files)},indent=2))
            if args.quarantine and files:
                destination = s.storage_root/'quarantine'/str(uuid.uuid4())
                if destination.resolve().is_relative_to(root): raise SystemExit('Unsafe quarantine location')
                for p in files:
                    target = destination/p.relative_to(root)
                    target.parent.mkdir(parents=True,exist_ok=True)
                    p.rename(target)
                print('Quarantined (restore relative paths to generated directory):',destination)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--days',type=int,default=7)
    parser.add_argument('--quarantine',action='store_true')
    parser.add_argument('--services-stopped',action='store_true',required=True)
    args=parser.parse_args()
    if args.days<1: parser.error('--days must be >= 1')
    asyncio.run(run(args))
