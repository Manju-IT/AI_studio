"""Validated streaming upload for reference audio used by voice cloning.

Rejects:
- Files larger than `MAX_UPLOAD_MB`.
- MIME types or extensions not in the allow-list.
- Empty or truncated files.
- Audio whose decoded duration is zero.

Normalizes to a mono 24 kHz PCM_16 WAV — the format Qwen3-TTS MNN expects —
so the reference can be handed to the engine without further conversion.
"""

from __future__ import annotations

import shutil
import asyncio
import uuid
from dataclasses import dataclass
from pathlib import Path

import soundfile as sf
from fastapi import UploadFile

from app.core.config import get_settings
from app.core.exceptions import AppError, ErrorCode

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".webm"}
ALLOWED_MIME_PREFIXES = ("audio/",)

# Reference audio shorter than this is not useful for cloning.
MIN_DURATION_SECONDS = 1.0
MAX_DURATION_SECONDS = 60.0

# Output format for normalized references.
NORMALIZED_SAMPLE_RATE = 24_000
NORMALIZED_CHANNELS = 1


@dataclass(frozen=True)
class ReferenceInfo:
    storage_path: Path
    original_filename: str
    duration_seconds: float
    sample_rate: int
    channels: int
    format: str
    file_size_bytes: int


def _ffmpeg_available() -> bool:
    settings = get_settings()
    return shutil.which(settings.ffmpeg_binary) is not None


async def _save_stream(upload: UploadFile, target: Path, max_bytes: int) -> int:
    """Stream the upload to `target` in 1 MiB chunks. Returns bytes written."""
    written = 0
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with target.open("wb") as fh:
            while True:
                chunk = await upload.read(1 << 20)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise AppError(
                        ErrorCode.VALIDATION_ERROR,
                        f"Upload exceeds {max_bytes // (1024 * 1024)} MB limit.",
                        status_code=413,
                    )
                fh.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()
    return written


def _inspect_and_normalize(source: Path, destination: Path) -> tuple[float, int, int, str]:
    """Return (duration, sample_rate, channels, format).

    Attempts soundfile first. If that fails (e.g. MP3 on a libsndfile build
    without MP3 support) and FFmpeg is available, transcode to WAV first.
    """
    try:
        with sf.SoundFile(str(source)) as fh:
            duration = len(fh) / fh.samplerate
            sr = fh.samplerate
            channels = fh.channels
            if duration > MAX_DURATION_SECONDS or channels > 8 or sr > 192000:
                raise AppError(ErrorCode.INVALID_AUDIO, "Reference exceeds decoding limits.", status_code=422)
            data = fh.read(dtype="float32")
    except AppError:
        raise
    except Exception as exc:
        if not _ffmpeg_available():
            raise AppError(
                ErrorCode.INVALID_AUDIO,
                f"Could not decode the uploaded audio ({exc}). "
                "Install FFmpeg to support this format.",
                status_code=422,
            ) from exc
        import subprocess

        settings = get_settings()
        temp_wav = source.with_suffix(".decoded.wav")
        try:
            subprocess.run(
                [settings.ffmpeg_binary, "-nostdin", "-y", "-i", str(source), "-t", "61", "-ac", "1", "-ar", "24000", str(temp_wav)],
                check=True,
                capture_output=True,
                timeout=60,
            )
            with sf.SoundFile(str(temp_wav)) as fh:
                duration = len(fh) / fh.samplerate
                sr = fh.samplerate
                channels = fh.channels
                data = fh.read(dtype="float32")
        finally:
            temp_wav.unlink(missing_ok=True)

    if duration < MIN_DURATION_SECONDS:
        raise AppError(
            ErrorCode.INVALID_AUDIO,
            f"Reference audio is too short ({duration:.2f}s). Provide at least "
            f"{MIN_DURATION_SECONDS:.0f}s.",
            status_code=422,
        )
    if duration > MAX_DURATION_SECONDS:
        raise AppError(
            ErrorCode.INVALID_AUDIO,
            f"Reference audio is too long ({duration:.1f}s). Keep it under "
            f"{MAX_DURATION_SECONDS:.0f}s.",
            status_code=422,
        )

    # Downmix to mono.
    import numpy as np

    if data.ndim > 1:
        data = data.mean(axis=1)

    if not np.isfinite(data).all() or float(np.sqrt(np.mean(data ** 2))) < 0.001:
        raise AppError(ErrorCode.INVALID_AUDIO, "Reference is silent or invalid.", status_code=422)

    # Resample if needed (linear interpolation — sufficient for reference audio).
    if sr != NORMALIZED_SAMPLE_RATE:
        ratio = NORMALIZED_SAMPLE_RATE / sr
        new_len = int(len(data) * ratio)
        x_old = np.linspace(0.0, 1.0, num=len(data), endpoint=False)
        x_new = np.linspace(0.0, 1.0, num=new_len, endpoint=False)
        data = np.interp(x_new, x_old, data).astype("float32")
        sr = NORMALIZED_SAMPLE_RATE

    destination.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(destination), data, sr, subtype="PCM_16")
    return len(data) / sr, sr, NORMALIZED_CHANNELS, "wav"


async def save_reference_audio(
    upload: UploadFile,
    *,
    voice_id: uuid.UUID,
) -> ReferenceInfo:
    settings = get_settings()

    if not upload.filename:
        raise AppError(ErrorCode.INVALID_AUDIO, "Filename is required.", status_code=400)

    suffix = Path(upload.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise AppError(
            ErrorCode.INVALID_AUDIO,
            f"Unsupported extension '{suffix}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
            status_code=422,
        )
    if upload.content_type and not any(
        upload.content_type.startswith(p) for p in ALLOWED_MIME_PREFIXES
    ):
        raise AppError(
            ErrorCode.INVALID_AUDIO,
            f"Unsupported content type '{upload.content_type}'.",
            status_code=422,
        )

    max_bytes = settings.max_upload_mb * 1024 * 1024
    raw_path = settings.temp_dir / f"ref_{voice_id.hex}_{uuid.uuid4().hex}{suffix}"
    normalized_path = settings.reference_audio_dir / str(voice_id) / f"reference_{uuid.uuid4().hex}.wav"

    try:
        written = await _save_stream(upload, raw_path, max_bytes)
        if written == 0:
            raise AppError(ErrorCode.INVALID_AUDIO, "Uploaded file is empty.", status_code=422)

        duration, sr, channels, fmt = await asyncio.to_thread(_inspect_and_normalize, raw_path, normalized_path)
    finally:
        raw_path.unlink(missing_ok=True)

    return ReferenceInfo(
        storage_path=normalized_path,
        original_filename=upload.filename,
        duration_seconds=duration,
        sample_rate=sr,
        channels=channels,
        format=fmt,
        file_size_bytes=normalized_path.stat().st_size,
    )