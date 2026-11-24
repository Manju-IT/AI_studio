"""FFmpeg-backed audio operations used by the trim / merge / export endpoints.

Trim and merge fall back to pure-Python (soundfile/numpy) for WAV inputs when
FFmpeg is unavailable, so these endpoints do not require FFmpeg to be installed
for the most common WAV workflow. MP3 export requires FFmpeg.
"""

from __future__ import annotations

import asyncio
import shutil
import uuid
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import AppError, ErrorCode
from app.services.audio.assets import create_audio_asset
from app.services.audio.chunker import merge_wav_files


def _ffmpeg_available() -> bool:
    settings = get_settings()
    return shutil.which(settings.ffmpeg_binary) is not None


async def _run_ffmpeg(args: list[str]) -> None:
    settings = get_settings()
    proc = await asyncio.create_subprocess_exec(
        settings.ffmpeg_binary,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise AppError(
            ErrorCode.INVALID_AUDIO,
            f"FFmpeg failed: {stderr.decode(errors='ignore')[:500]}",
            status_code=422,
        )


async def trim_audio(
    *,
    session: AsyncSession,
    workspace_id: uuid.UUID,
    owner_id: uuid.UUID | None,
    source: Path,
    start: float,
    end: float,
    title: str,
    project_id: uuid.UUID | None = None,
) -> SimpleNamespace:
    """Trim `source` to the [start, end] range and persist a new AudioAsset.

    Uses FFmpeg when available; otherwise for WAV sources falls back to
    soundfile-based slicing.
    """
    if end <= start:
        raise AppError(ErrorCode.VALIDATION_ERROR, "end must be greater than start.", status_code=400)

    settings = get_settings()
    output = settings.generated_audio_dir / f"trim_{uuid.uuid4().hex}.wav"
    duration = end - start

    if _ffmpeg_available():
        await _run_ffmpeg(
            [
                "-y",
                "-i",
                str(source),
                "-ss",
                f"{start:.3f}",
                "-t",
                f"{duration:.3f}",
                "-c:a",
                "pcm_s16le",
                str(output),
            ]
        )
    else:
        import numpy as np
        import soundfile as sf

        if source.suffix.lower() != ".wav":
            raise AppError(
                ErrorCode.INVALID_AUDIO,
                "FFmpeg is required to trim non-WAV sources. Install FFmpeg or convert to WAV first.",
                status_code=422,
            )
        with sf.SoundFile(str(source)) as fh:
            sr = fh.samplerate
            fh.seek(int(start * sr))
            frames = fh.read(int(duration * sr), dtype="float32")
        output.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output), frames, sr, subtype="PCM_16")

    asset = await create_audio_asset(
        session,
        workspace_id=workspace_id,
        owner_id=owner_id,
        project_id=project_id,
        source_path=output,
        title=title,
        original_filename=output.name,
    )
    return SimpleNamespace(asset=asset)


async def merge_audio(
    *,
    session: AsyncSession,
    workspace_id: uuid.UUID,
    owner_id: uuid.UUID | None,
    sources: list[Path],
    pause_ms: int,
    title: str,
    project_id: uuid.UUID | None = None,
) -> SimpleNamespace:
    """Concatenate multiple audio files into a single WAV and persist an AudioAsset."""
    if not sources:
        raise AppError(ErrorCode.VALIDATION_ERROR, "At least one source is required.", status_code=400)

    settings = get_settings()
    output = settings.generated_audio_dir / f"merge_{uuid.uuid4().hex}.wav"

    if all(p.suffix.lower() == ".wav" for p in sources):
        merge_wav_files(sources, output, pause_ms=pause_ms)
    else:
        if not _ffmpeg_available():
            raise AppError(
                ErrorCode.INVALID_AUDIO,
                "FFmpeg is required to merge non-WAV sources.",
                status_code=422,
            )
        list_file = settings.temp_dir / f"concat_{uuid.uuid4().hex}.txt"
        try:
            list_file.write_text(
                "\n".join(f"file '{p.resolve().as_posix()}'" for p in sources),
                encoding="utf-8",
            )
            await _run_ffmpeg(
                [
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(list_file),
                    "-c:a",
                    "pcm_s16le",
                    str(output),
                ]
            )
        finally:
            list_file.unlink(missing_ok=True)

    asset = await create_audio_asset(
        session,
        workspace_id=workspace_id,
        owner_id=owner_id,
        project_id=project_id,
        source_path=output,
        title=title,
        original_filename=output.name,
    )
    return SimpleNamespace(asset=asset)


async def export_audio_to_format(
    *,
    source: Path,
    target_format: str,
    output_path: Path,
) -> Path:
    """Convert an audio file to MP3 or re-encode WAV. Requires FFmpeg for MP3."""
    if target_format.lower() == "wav":
        # Normalize WAV to PCM 16 without ffmpeg.
        import soundfile as sf

        with sf.SoundFile(str(source)) as fh:
            data = fh.read(dtype="float32")
            sr = fh.samplerate
        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output_path), data, sr, subtype="PCM_16")
        return output_path

    if target_format.lower() != "mp3":
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"Unsupported export format: {target_format}",
            status_code=400,
        )
    if not _ffmpeg_available():
        raise AppError(
            ErrorCode.INVALID_AUDIO,
            "FFmpeg is required to export MP3.",
            status_code=422,
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    await _run_ffmpeg(
        [
            "-y",
            "-i",
            str(source),
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(output_path),
        ]
    )
    return output_path