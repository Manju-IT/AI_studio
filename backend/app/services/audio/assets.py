from __future__ import annotations

import uuid
from pathlib import Path

import soundfile as sf
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audio import AudioAsset
from app.services.audio.hashing import sha256_file


_MIME_BY_FORMAT = {
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "flac": "audio/flac",
    "ogg": "audio/ogg",
}


async def create_audio_asset(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    owner_id: uuid.UUID | None,
    source_path: Path,
    title: str,
    project_id: uuid.UUID | None = None,
    folder_id: uuid.UUID | None = None,
    voice_id: uuid.UUID | None = None,
    model_installation_id: uuid.UUID | None = None,
    generation_job_id: uuid.UUID | None = None,
    original_filename: str | None = None,
) -> AudioAsset:
    """Inspect a finished audio file and persist an AudioAsset record.

    Does not commit — the caller controls the transaction boundary.
    """
    if not source_path.exists():
        raise FileNotFoundError(f"Audio file not found: {source_path}")

    with sf.SoundFile(str(source_path)) as fh:
        sample_rate = fh.samplerate
        channels = fh.channels
        frames = len(fh)
    duration = frames / sample_rate if sample_rate else 0.0

    fmt = source_path.suffix.lstrip(".").lower() or "wav"
    mime = _MIME_BY_FORMAT.get(fmt, "application/octet-stream")
    checksum = sha256_file(source_path)
    size = source_path.stat().st_size

    asset = AudioAsset(
        workspace_id=workspace_id,
        owner_id=owner_id,
        project_id=project_id,
        folder_id=folder_id,
        storage_path=str(source_path.resolve()),
        original_filename=original_filename or source_path.name,
        mime_type=mime,
        format=fmt,
        duration_seconds=duration,
        sample_rate=sample_rate,
        channels=channels,
        file_size_bytes=size,
        checksum_sha256=checksum,
        generation_job_id=generation_job_id,
        voice_id=voice_id,
        model_installation_id=model_installation_id,
        title=title,
    )
    session.add(asset)
    await session.flush()
    return asset