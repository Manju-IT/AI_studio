"""Owner-scoped local job controls; TTS remains on its existing endpoints."""
from uuid import UUID
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import current_user, db_session
from app.core.config import get_settings
from app.models.job import GenerationJob
from app.models.user import User
from app.services.jobs.local_queue import load
from app.services.jobs.queue_controls import transition

router = APIRouter()


def public(path, data, kind):
    return dict(id=path.stem, kind=kind, title=data.get('title') or 'Voice extraction', status=data.get('status'), error=data.get('error'), updated_at=path.stat().st_mtime)


@router.get('')
async def list_queue(user: User = Depends(current_user), session: AsyncSession = Depends(db_session)):
    root = get_settings().storage_root
    rows = []
    for kind, directory in [('extract','extraction_jobs'), ('asr','transcriptions')]:
        for path in (root / directory / str(user.id)).glob('*.json'):
            try:
                rows.append(public(path, load(path), kind))
            except (OSError, ValueError):
                continue
    result = await session.execute(select(GenerationJob.id, GenerationJob.status, GenerationJob.created_at, GenerationJob.error_message).where(GenerationJob.created_by_user_id == user.id).order_by(GenerationJob.created_at.desc()).limit(100))
    for row in result:
        rows.append(dict(id=str(row.id), kind='tts', title='Speech generation', status=row.status, error=row.error_message, updated_at=row.created_at.timestamp()))
    return sorted(rows, key=lambda row: (row['status'] not in ('queued','processing','running','loading_model'), -row['updated_at']))[:200]


@router.post('/{kind}/{job_id}/{action}')
async def control(kind: Literal['extract','asr'], job_id: UUID, action: Literal['cancel','retry'], user: User = Depends(current_user)):
    directory = 'extraction_jobs' if kind == 'extract' else 'transcriptions'
    path = get_settings().storage_root / directory / str(user.id) / f'{job_id}.json'
    if not path.is_file():
        raise HTTPException(404, 'Job not found')
    # Extraction retries go through the existing endpoint, which revalidates consent and model.
    if kind == 'extract' and action == 'retry':
        raise HTTPException(409, 'Retry extraction from Voice Cloning.')
    try:
        data = transition(path, {'queued'} if action == 'cancel' else {'failed','cancelled'}, 'cancelled' if action == 'cancel' else 'queued')
    except (ValueError, OSError) as exc:
        raise HTTPException(409, str(exc)) from exc
    return public(path, data, kind)
