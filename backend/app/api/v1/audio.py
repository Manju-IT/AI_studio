from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, db_session
from app.core.config import get_settings
from app.core.exceptions import AppError, ErrorCode, NotFoundError
from app.models.audio import AudioAsset
from app.models.user import User
from app.schemas.audio import AudioAssetOut, ExportRequest, MergeRequest, TrimRequest
from app.services.audio.assets import create_audio_asset
from app.services.audio.ffmpeg import (
    export_audio_to_format,
    merge_audio as merge_audio_service,
    trim_audio as trim_audio_service,
)

router = APIRouter()


@router.get("", response_model=list[AudioAssetOut])
async def list_audio(
    project_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> list[AudioAssetOut]:
    stmt = (
        select(AudioAsset)
        .where(AudioAsset.owner_id == user.id)
        .order_by(AudioAsset.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if project_id is not None:
        stmt = stmt.where(AudioAsset.project_id == project_id)
    rows = (await session.scalars(stmt)).all()
    return [AudioAssetOut.model_validate(r) for r in rows]


@router.get("/{asset_id}", response_model=AudioAssetOut)
async def get_audio(
    asset_id: uuid.UUID,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> AudioAssetOut:
    asset = await session.scalar(select(AudioAsset).where(AudioAsset.id == asset_id))
    if asset is None:
        raise NotFoundError("AudioAsset", str(asset_id))
    return AudioAssetOut.model_validate(asset)


@router.get("/{asset_id}/download")
async def download_audio(
    asset_id: uuid.UUID,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> FileResponse:
    asset = await session.scalar(select(AudioAsset).where(AudioAsset.id == asset_id))
    if asset is None:
        raise NotFoundError("AudioAsset", str(asset_id))
    path = Path(asset.storage_path)
    if not path.exists():
        raise NotFoundError("AudioFile", str(asset_id))
    return FileResponse(path, media_type=asset.mime_type, filename=asset.original_filename)


@router.post("/trim", response_model=AudioAssetOut)
async def trim_audio(
    payload: TrimRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> AudioAssetOut:
    source = await session.scalar(select(AudioAsset).where(AudioAsset.id == payload.audio_asset_id))
    if source is None:
        raise NotFoundError("AudioAsset", str(payload.audio_asset_id))
    result = await trim_audio_service(
        session=session,
        workspace_id=source.workspace_id,
        owner_id=user.id,
        source=Path(source.storage_path),
        start=payload.start_seconds,
        end=payload.end_seconds,
        title=payload.title or source.title or "Trimmed audio",
        project_id=source.project_id,
    )
    await session.commit()
    return AudioAssetOut.model_validate(result.asset)


@router.post("/merge", response_model=AudioAssetOut)
async def merge_audio(
    payload: MergeRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> AudioAssetOut:
    assets = (
        await session.scalars(select(AudioAsset).where(AudioAsset.id.in_(payload.audio_asset_ids)))
    ).all()
    if len(assets) != len(payload.audio_asset_ids):
        raise NotFoundError("AudioAsset", "one or more ids not found")
    ordered = sorted(assets, key=lambda a: payload.audio_asset_ids.index(a.id))
    workspace_id = ordered[0].workspace_id
    if any(a.workspace_id != workspace_id for a in ordered):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "All merged assets must belong to the same workspace.",
            status_code=400,
        )
    result = await merge_audio_service(
        session=session,
        workspace_id=workspace_id,
        owner_id=user.id,
        sources=[Path(a.storage_path) for a in ordered],
        pause_ms=payload.pause_ms,
        title=payload.title or "Merged audio",
        project_id=ordered[0].project_id,
    )
    await session.commit()
    return AudioAssetOut.model_validate(result.asset)


@router.post("/export", response_model=AudioAssetOut)
async def export_audio(
    payload: ExportRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> AudioAssetOut:
    source = await session.scalar(select(AudioAsset).where(AudioAsset.id == payload.audio_asset_id))
    if source is None:
        raise NotFoundError("AudioAsset", str(payload.audio_asset_id))

    settings = get_settings()
    out_path = settings.export_dir / f"export_{source.id.hex}.{payload.format}"
    await export_audio_to_format(
        source=Path(source.storage_path),
        target_format=payload.format,
        output_path=out_path,
    )
    asset = await create_audio_asset(
        session,
        workspace_id=source.workspace_id,
        owner_id=user.id,
        project_id=source.project_id,
        source_path=out_path,
        title=source.title or "Exported audio",
        original_filename=f"{source.id.hex}.{payload.format}",
    )
    await session.commit()
    return AudioAssetOut.model_validate(asset)