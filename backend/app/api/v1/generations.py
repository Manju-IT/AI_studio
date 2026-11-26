
from __future__ import annotations

import uuid
from inference.voice_assets import usable

from fastapi import APIRouter, Depends, status

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession


from app.api.deps import current_user, db_session
from app.core.exceptions import NotFoundError, AppError, ErrorCode
from app.models.job import GenerationJob
from app.models.project import Project
from app.models.model import ModelInstallation
from app.models.voice import Voice
from app.models.user import User, Workspace
from app.schemas.job import GenerationJobOut, GenerationSubmitRequest

from inference.manager.capability_registry import validate_settings

router = APIRouter()


# Eagerly load relationships to prevent MissingGreenlet errors.
def job_query():
    return select(GenerationJob).options(
        selectinload(GenerationJob.chunks),
        selectinload(GenerationJob.audio_asset),
    )


@router.post("", response_model=GenerationJobOut, status_code=status.HTTP_201_CREATED)
async def submit_generation(
    payload: GenerationSubmitRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> GenerationJobOut:
    if payload.idempotency_key:
        existing = await session.scalar(
            job_query().where(
                GenerationJob.idempotency_key == payload.idempotency_key
            )
        )
        if existing is not None:
            if existing.created_by_user_id != user.id:
                raise AppError(ErrorCode.FORBIDDEN, "Idempotency key belongs to another user.", status_code=403)
            return GenerationJobOut.model_validate(existing)

    if not payload.text.strip():
        raise AppError(ErrorCode.VALIDATION_ERROR, "Script cannot be empty.")
    model = await session.get(ModelInstallation, payload.model_installation_id)
    if model is None or model.installation_state == "invalid":
        raise AppError(ErrorCode.MODEL_NOT_INSTALLED, "Select an available model.")
    await session.refresh(model, attribute_names=["definition"])
    if payload.language not in model.definition.languages:
        raise AppError(ErrorCode.UNSUPPORTED_LANGUAGE, "Language is not supported by this model.")
    try:
        normalized_settings = validate_settings(model.runtime, payload.settings)
    except ValueError as exc:
        raise AppError(ErrorCode.VALIDATION_ERROR, str(exc), status_code=422) from exc
    if payload.voice_id:
        voice = await session.get(Voice, payload.voice_id)
        if voice is None or not usable(voice, user.id, model) or voice.owner_id not in (None, user.id) or not voice.is_active or voice.language.lower() != payload.language.lower() or voice.model_installation_id != model.id or model.runtime == "piper":
            raise AppError(ErrorCode.VALIDATION_ERROR, "Select an active voice matching the language.")
    workspace = await session.scalar(select(Workspace).limit(1))
    if workspace is None:
        raise NotFoundError("Workspace", "default")

    if payload.project_id:
        project = await session.get(Project, payload.project_id)
        if not project or project.owner_id != user.id or project.is_archived:
            raise AppError(ErrorCode.FORBIDDEN, "Project unavailable.", status_code=403)
        workspace = await session.get(Workspace, project.workspace_id)

    job = GenerationJob(
        workspace_id=workspace.id,
        created_by_user_id=user.id,
        model_installation_id=payload.model_installation_id,
        voice_id=payload.voice_id,
        project_id=payload.project_id,
        status="queued",
        text=payload.text,
        language=payload.language,
        settings=normalized_settings,
        is_long_form=payload.long_form,
        progress_current=0,
        progress_total=1 if not payload.long_form else 0,
        idempotency_key=payload.idempotency_key,
    )
    session.add(job)
    try:
        await session.commit()
    except IntegrityError:
        # Two concurrent requests with the same key; return the winner.
        await session.rollback()
        existing = await session.scalar(
            job_query().where(
                GenerationJob.idempotency_key == payload.idempotency_key
            )
        )
        if existing is None:
            raise
        if existing.created_by_user_id != user.id:
            raise AppError(ErrorCode.FORBIDDEN, "Idempotency key belongs to another user.", status_code=403)
        return GenerationJobOut.model_validate(existing)
    result = await session.scalar(job_query().where(GenerationJob.id == job.id))
    return GenerationJobOut.model_validate(result)
    


@router.get("", response_model=list[GenerationJobOut])
async def list_generations(
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> list[GenerationJobOut]:

    rows = (
        await session.scalars(
            job_query()
            .where(GenerationJob.created_by_user_id == user.id)
            .order_by(GenerationJob.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    return [
        GenerationJobOut.model_validate(row)
        for row in rows
    ]


@router.get("/{job_id}", response_model=GenerationJobOut)
async def get_generation(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> GenerationJobOut:

    job = await session.scalar(
        job_query().where(GenerationJob.id == job_id, GenerationJob.created_by_user_id == user.id)
    )

    if job is None:
        raise NotFoundError("GenerationJob", str(job_id))

    return GenerationJobOut.model_validate(job)


@router.post("/{job_id}/cancel", response_model=GenerationJobOut)
async def cancel_generation(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> GenerationJobOut:

    job = await session.scalar(
        job_query().where(GenerationJob.id == job_id, GenerationJob.created_by_user_id == user.id)
    )

    if job is None:
        raise NotFoundError("GenerationJob", str(job_id))

    if job.status in {"completed", "failed", "cancelled"}:
        from app.core.exceptions import AppError, ErrorCode

        raise AppError(
            ErrorCode.JOB_ALREADY_TERMINAL,
            "Job is already terminal.",
            status_code=409,
        )

    job.cancellation_requested = True

    if job.status == "queued":
        job.status = "cancelled"

    await session.commit()

    # Reload relationships after commit.
    result = await session.scalar(
        job_query().where(GenerationJob.id == job_id, GenerationJob.created_by_user_id == user.id)
    )

    if result is None:
        raise NotFoundError("GenerationJob", str(job_id))

    return GenerationJobOut.model_validate(result)
