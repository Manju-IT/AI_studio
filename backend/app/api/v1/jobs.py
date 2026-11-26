from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette import EventSourceResponse, JSONServerSentEvent

from app.api.deps import admin_user, current_user, db_session
from app.core.exceptions import AppError, ErrorCode, NotFoundError
from app.models.job import GenerationChunk, GenerationJob
from app.models.user import User, Workspace
from app.schemas.job import GenerationChunkOut, GenerationJobOut
from app.services.jobs.recovery import recover_orphaned_jobs

router = APIRouter()

TERMINAL = {"completed", "failed", "cancelled"}


@router.get("/{job_id}", response_model=GenerationJobOut)
async def get_job(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> GenerationJobOut:
    job = await session.scalar(select(GenerationJob).where(GenerationJob.id == job_id, GenerationJob.created_by_user_id == user.id))
    if job is None:
        raise NotFoundError("GenerationJob", str(job_id))
    return GenerationJobOut.model_validate(job)


@router.get("/{job_id}/chunks", response_model=list[GenerationChunkOut])
async def list_chunks(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> list[GenerationChunkOut]:
    job = await session.scalar(select(GenerationJob).where(GenerationJob.id == job_id, GenerationJob.created_by_user_id == user.id))
    if job is None:
        raise NotFoundError("GenerationJob", str(job_id))
    rows = (
        await session.scalars(
            select(GenerationChunk)
            .where(GenerationChunk.job_id == job_id)
            .order_by(GenerationChunk.index)
        )
    ).all()
    return [GenerationChunkOut.model_validate(r) for r in rows]


@router.post("/{job_id}/retry", response_model=GenerationJobOut)
async def retry_job(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> GenerationJobOut:
    """Create a new job that copies the parameters of a failed or cancelled one."""
    original = await session.scalar(select(GenerationJob).where(GenerationJob.id == job_id, GenerationJob.created_by_user_id == user.id))
    if original is None:
        raise NotFoundError("GenerationJob", str(job_id))
    if original.status not in {"failed", "cancelled"}:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"Only failed or cancelled jobs can be retried (current: {original.status}).",
            status_code=409,
        )

    workspace = await session.scalar(select(Workspace).where(Workspace.id == original.workspace_id))
    if workspace is None:
        raise NotFoundError("Workspace", "default")

    clone = GenerationJob(
        workspace_id=workspace.id,
        created_by_user_id=user.id,
        model_installation_id=original.model_installation_id,
        voice_id=original.voice_id,
        project_id=original.project_id,
        status="queued",
        text=original.text,
        language=original.language,
        settings=dict(original.settings or {}),
        is_long_form=original.is_long_form,
        progress_current=0,
        progress_total=1 if not original.is_long_form else 0,
    )
    session.add(clone)
    await session.commit()
    await session.refresh(clone)
    return GenerationJobOut.model_validate(clone)


@router.post("/recover")
async def trigger_recovery(user: User = Depends(admin_user)) -> dict[str, int]:
    """Requeue orphaned jobs. Safe to call at any time; no-op if a worker is alive."""
    return await recover_orphaned_jobs(force=False)


@router.get("/{job_id}/events")
async def job_events(
    job_id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
) -> EventSourceResponse:
    async def event_stream():
        from app.db.session import SessionFactory

        while True:
            if await request.is_disconnected():
                break
            async with SessionFactory() as session:
                job = await session.scalar(
                    select(GenerationJob).where(GenerationJob.id == job_id, GenerationJob.created_by_user_id == user.id)
                )
                if job is None:
                    yield JSONServerSentEvent(data={"error": "not_found"})
                    break
                yield JSONServerSentEvent(
                    data={
                        "id": str(job.id),
                        "status": job.status,
                        "progress_current": job.progress_current,
                        "progress_total": job.progress_total,
                        "error_message": job.error_message,
                    },
                    event="progress",
                )
                if job.status in TERMINAL:
                    break
            await asyncio.sleep(1.0)

    return EventSourceResponse(event_stream(), ping=15)