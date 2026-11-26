from __future__ import annotations

import uuid
import asyncio
from inference.voice_assets import ready, profile_path
from app.services.jobs.local_queue import extraction_path, load, save
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload
from app.core.exceptions import ForbiddenError, AppError, ErrorCode
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, db_session
from app.core.exceptions import CapabilityUnsupportedError, NotFoundError
from app.models.model import ModelInstallation
from app.models.user import User, Workspace
from app.models.voice import Voice, VoiceAuthorization, VoiceSample
from app.schemas.voice import (
    CloneRequest,
    DesignRequest,
    VoiceFavoriteRequest,
    VoiceOut,
    VoiceSampleOut,
)
from app.services.audio.upload import save_reference_audio

router = APIRouter()


async def _default_workspace(session: AsyncSession) -> Workspace:
    workspace = await session.scalar(select(Workspace).limit(1))
    if workspace is None:
        raise NotFoundError("Workspace", "default")
    return workspace


@router.get("", response_model=list[VoiceOut])
async def list_voices(
    language: str | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> list[VoiceOut]:
    stmt = select(Voice).options(selectinload(Voice.samples)).where(Voice.is_active.is_(True), or_(Voice.owner_id == user.id, (Voice.owner_id.is_(None) & (Voice.source == "builtin"))))
    if language:
        stmt = stmt.where(Voice.language == language.lower())
    rows = (await session.scalars(stmt.order_by(Voice.name))).all()
    return [VoiceOut.model_validate(r).model_copy(update={"synthesis_ready": ready(r)}) for r in rows]


@router.post("/{voice_id}/favorite", response_model=VoiceOut)
async def favorite_voice(
    voice_id: uuid.UUID,
    payload: VoiceFavoriteRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> VoiceOut:
    voice = await session.scalar(select(Voice).options(selectinload(Voice.samples)).where(Voice.id == voice_id).with_for_update())
    if voice is None:
        raise NotFoundError("Voice", str(voice_id))
    if voice.owner_id != user.id:
        raise ForbiddenError("Only the owner may change this voice.")
    voice.is_favorite = payload.is_favorite
    await session.commit()
    await session.refresh(voice, attribute_names=["samples"])
    return VoiceOut.model_validate(voice)


@router.delete("/{voice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_voice(
    voice_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> None:
    voice = await session.scalar(select(Voice).options(selectinload(Voice.samples)).where(Voice.id == voice_id).with_for_update())
    if voice is None:
        raise NotFoundError("Voice", str(voice_id))
    if voice.owner_id != user.id and user.role != "admin":
        from app.core.exceptions import ForbiddenError

        raise ForbiddenError("You do not own this voice.")
    # Soft delete — sample files are retained on disk for the audit trail.
    voice.is_active = False
    await session.commit()


@router.post("/clone", response_model=VoiceOut, status_code=status.HTTP_201_CREATED)
async def create_cloned_voice(
    payload: CloneRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> VoiceOut:
    """Register the consent record and a cloned-voice row.

    Model-side extraction is queued separately after reference upload.
    This endpoint does not fabricate a cloned voice; it records the user's
    intent and authorisation, and prepares the voice for reference upload.
    """
    workspace = await _default_workspace(session)

    # If a model installation is specified, verify it actually advertises cloning.
    if payload.model_installation_id is not None:
        installation = await session.scalar(
            select(ModelInstallation).where(
                ModelInstallation.id == payload.model_installation_id
            )
        )
        if installation is None:
            raise NotFoundError("ModelInstallation", str(payload.model_installation_id))
        await session.refresh(installation, attribute_names=["definition"])
        caps = installation.definition.capabilities or {}
        if installation.runtime != "qwen_mnn" or not caps.get("voice_cloning"):
            raise CapabilityUnsupportedError(
                "voice_cloning", installation.manifest_id
            )

    if payload.model_installation_id is None:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Select a Qwen model.", status_code=422)
    voice = Voice(
        workspace_id=workspace.id,
        owner_id=user.id,
        name=payload.name,
        language=payload.language,
        source="cloned",
        model_installation_id=payload.model_installation_id,
        description=f"Cloned voice for {payload.speaker_name}",
    )
    session.add(voice)
    await session.flush()

    authorization = VoiceAuthorization(
        voice_id=voice.id,
        speaker_name=payload.speaker_name,
        consent_statement=payload.consent_statement,
        consent_metadata={
            "reference_text": payload.reference_text,
            "captured_at": datetime.now(timezone.utc).isoformat(),
        },
        authorized_by_user_id=user.id,
        authorized_at=datetime.now(timezone.utc),
    )
    session.add(authorization)

    await session.commit()
    await session.refresh(voice, attribute_names=["samples"])
    return VoiceOut.model_validate(voice)


@router.post(
    "/{voice_id}/reference",
    response_model=VoiceSampleOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_reference(
    voice_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> VoiceSampleOut:
    voice = await session.scalar(select(Voice).options(selectinload(Voice.samples)).where(Voice.id == voice_id).with_for_update())
    if voice is None:
        raise NotFoundError("Voice", str(voice_id))
    if voice.owner_id != user.id or not voice.is_active:
        raise ForbiddenError("Voice unavailable.")
    if voice.source != "cloned":
        from app.core.exceptions import AppError, ErrorCode

        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "Reference audio can only be uploaded for cloned voices.",
            status_code=422,
        )

    authorization = await session.scalar(select(VoiceAuthorization).where(VoiceAuthorization.voice_id == voice.id))
    if authorization is None:
        raise ForbiddenError("Speaker authorization is required.")
    job_path = extraction_path(user.id, voice.id)
    if job_path.exists() and load(job_path)["status"] in ("queued", "processing"):
        raise AppError(ErrorCode.VALIDATION_ERROR, "Extraction is active.", status_code=409)
    if profile_path(voice.id).exists():
        raise AppError(ErrorCode.VALIDATION_ERROR, "Ready profiles are immutable; create a new voice.", status_code=409)
    info = await save_reference_audio(file, voice_id=voice.id)

    sample = VoiceSample(
        voice_id=voice.id,
        storage_path=str(info.storage_path),
        original_filename=info.original_filename,
        duration_seconds=info.duration_seconds,
        sample_rate=info.sample_rate,
        channels=info.channels,
        format=info.format,
        file_size_bytes=info.file_size_bytes,
        is_reference=True,
    )
    session.add(sample)
    await session.commit()
    await session.refresh(sample)
    return VoiceSampleOut.model_validate(sample)


@router.post("/design", response_model=VoiceOut, status_code=status.HTTP_201_CREATED)
async def create_designed_voice(
    payload: DesignRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> VoiceOut:
    """Persist a voice-design prompt.

    Generation requires a model with `voice_design` capability. No such model
    is integrated yet (Qwen VoiceDesign 1.7B is Phase 7), so this endpoint only
    records the prompt. The Studio will refuse to generate audio for this voice
    until a capable model is loaded.
    """
    raise CapabilityUnsupportedError("voice_design", "No integrated runtime")


@router.post("/{voice_id}/extract", status_code=202)
async def extract_profile(voice_id: uuid.UUID, user: User = Depends(current_user), session: AsyncSession = Depends(db_session)):
    voice = await session.scalar(select(Voice).options(selectinload(Voice.samples)).where(Voice.id == voice_id, Voice.owner_id == user.id, Voice.is_active.is_(True)).with_for_update())
    if voice is None or voice.source != "cloned": raise NotFoundError("Voice", str(voice_id))
    model = await session.get(ModelInstallation, voice.model_installation_id) if voice.model_installation_id else None
    auth = await session.scalar(select(VoiceAuthorization).where(VoiceAuthorization.voice_id == voice.id))
    samples = sorted((s for s in voice.samples if s.is_reference), key=lambda s: s.created_at, reverse=True)
    if not model or model.runtime != "qwen_mnn" or not auth or not samples:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Qwen model, consent and reference required.", status_code=422)
    transcript = (auth.consent_metadata or {}).get("reference_text", "").strip()
    if not transcript: raise AppError(ErrorCode.VALIDATION_ERROR, "Reference transcript required.", status_code=422)
    path = extraction_path(user.id, voice.id)
    if ready(voice):
        return {"status": "completed", "error": None}
    from app.services.jobs.worker_lock import worker_lock
    with worker_lock(path.with_suffix('.lock')) as acquired:
        if not acquired:
            raise AppError(ErrorCode.VALIDATION_ERROR, "Job is busy; retry shortly.", status_code=409)
        if path.exists():
            previous = load(path)
            if previous["status"] in ("queued", "processing"):
                return {"status": previous["status"], "error": None}
        save(path, dict(kind="extract", voice_id=str(voice.id), owner_id=str(user.id), status="queued", error=None))
    return {"status": "queued", "error": None}


@router.get("/{voice_id}/extract")
async def extraction_status(voice_id: uuid.UUID, user: User = Depends(current_user), session: AsyncSession = Depends(db_session)):
    voice = await session.scalar(select(Voice).where(Voice.id == voice_id, Voice.owner_id == user.id, Voice.is_active.is_(True)))
    if voice is None: raise NotFoundError("Voice", str(voice_id))
    path = extraction_path(user.id, voice_id)
    if ready(voice): return {"status": "completed", "error": None}
    data = load(path) if path.exists() else {"status": "pending", "error": None}
    return {"status": data["status"], "error": data.get("error")}
