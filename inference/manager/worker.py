"""Inference worker process.

Runs a persistent loop that:
1. Writes a heartbeat file so the API can report liveness.
2. Atomically claims a queued generation job with SELECT ... FOR UPDATE SKIP LOCKED.
3. Ensures the required model is loaded via ModelManager (unloads the previous one).
4. Generates audio, persists the AudioAsset, and marks the job completed/failed.

The worker never reads or writes through FastAPI. It uses the same SQLAlchemy
session factory, so both processes share database semantics.
"""

from __future__ import annotations

import asyncio
import signal
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.session import SessionFactory
from app.models.audio import AudioAsset
from app.models.job import GenerationChunk, GenerationJob
from app.models.model import ModelInstallation
from app.models.voice import Voice
from app.services.audio.assets import create_audio_asset
from app.services.audio.chunker import chunk_text, merge_wav_files
from inference.contracts.types import Capability, TTSRequest
from inference.manager.loader import ModelLifecycleError, ModelManager
from inference.manager.registry import ManifestRegistry

log = get_logger("worker")


# ---------------------------------------------------------------------------
# Heartbeat
# ---------------------------------------------------------------------------


def _write_heartbeat() -> None:
    settings = get_settings()
    path = Path(settings.temp_dir) / "worker_heartbeat"
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(str(time.time()), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Job claiming (single atomic statement)
# ---------------------------------------------------------------------------


_CLAIM_SQL = text(
    """
    WITH next AS (
        SELECT id FROM generation_jobs
        WHERE status = 'queued'
          AND cancellation_requested = false
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    UPDATE generation_jobs j
    SET status = 'running',
        started_at = now(),
        updated_at = now()
    FROM next
    WHERE j.id = next.id
    RETURNING j.id
    """
)


async def _claim_job() -> uuid.UUID | None:
    async with SessionFactory() as session:
        async with session.begin():
            row = (await session.execute(_CLAIM_SQL)).first()
            if row is None:
                return None
            return row[0]


async def _is_cancelled(job_id: uuid.UUID) -> bool:
    async with SessionFactory() as session:
        job = await session.scalar(select(GenerationJob).where(GenerationJob.id == job_id))
        return bool(job and job.cancellation_requested)


async def _update_progress(job_id: uuid.UUID, current: int, total: int) -> None:
    async with SessionFactory() as session:
        async with session.begin():
            job = await session.scalar(
                select(GenerationJob).where(GenerationJob.id == job_id).with_for_update()
            )
            if job is None:
                return
            job.progress_current = current
            job.progress_total = total


# ---------------------------------------------------------------------------
# Job execution
# ---------------------------------------------------------------------------


@dataclass
class _JobContext:
    job_id: uuid.UUID
    workspace_id: uuid.UUID
    owner_id: uuid.UUID | None
    manifest_id: str
    text: str
    language: str
    voice_id: uuid.UUID | None
    voice_identifier: str | None
    voice_language: str | None
    project_id: uuid.UUID | None
    settings: dict[str, Any]
    is_long_form: bool


async def _load_job_context(job_id: uuid.UUID) -> _JobContext | None:
    async with SessionFactory() as session:
        job = await session.scalar(select(GenerationJob).where(GenerationJob.id == job_id))
        if job is None:
            return None

        installation = (
            await session.scalar(
                select(ModelInstallation).where(ModelInstallation.id == job.model_installation_id)
            )
            if job.model_installation_id
            else None
        )
        if installation is None:
            raise RuntimeError("Job is missing a model installation.")

        voice = (
            await session.scalar(select(Voice).where(Voice.id == job.voice_id))
            if job.voice_id
            else None
        )

        return _JobContext(
            job_id=job.id,
            workspace_id=job.workspace_id,
            owner_id=job.created_by_user_id,
            manifest_id=installation.manifest_id,
            text=job.text,
            language=job.language,
            voice_id=job.voice_id,
            voice_identifier=voice.name if voice else None,
            voice_language=voice.language if voice else None,
            project_id=job.project_id,
            settings=dict(job.settings or {}),
            is_long_form=job.is_long_form,
        )


async def _fail_job(job_id: uuid.UUID, code: str, message: str) -> None:
    async with SessionFactory() as session:
        async with session.begin():
            job = await session.scalar(
                select(GenerationJob).where(GenerationJob.id == job_id).with_for_update()
            )
            if job is None:
                return
            job.status = "failed"
            job.error_code = code
            job.error_message = message[:2000]
            job.finished_at = job.updated_at


async def _complete_job(
    job_id: uuid.UUID,
    asset_id: uuid.UUID,
    duration: float,
) -> None:
    async with SessionFactory() as session:
        async with session.begin():
            job = await session.scalar(
                select(GenerationJob).where(GenerationJob.id == job_id).with_for_update()
            )
            if job is None:
                return
            job.status = "completed"
            job.audio_asset_id = asset_id
            job.duration_seconds = duration
            job.finished_at = job.updated_at
            job.progress_current = job.progress_total


async def _cancel_job(job_id: uuid.UUID) -> None:
    async with SessionFactory() as session:
        async with session.begin():
            job = await session.scalar(
                select(GenerationJob).where(GenerationJob.id == job_id).with_for_update()
            )
            if job is None:
                return
            job.status = "cancelled"
            job.finished_at = job.updated_at


async def _run_single(ctx: _JobContext, manager: ModelManager) -> None:
    engine = await manager.ensure_loaded(ctx.manifest_id)

    if Capability.TEXT_TO_SPEECH not in engine.capabilities():
        raise RuntimeError(f"Engine '{ctx.manifest_id}' does not support text_to_speech.")

    settings = get_settings()
    out_path = settings.generated_audio_dir / f"single_{ctx.job_id.hex}.wav"

    request = TTSRequest(
        text=ctx.text,
        language=ctx.language,
        voice_id=ctx.voice_identifier,
        settings=ctx.settings,
        output_path=out_path,
    )

    if await _is_cancelled(ctx.job_id):
        await _cancel_job(ctx.job_id)
        return

    result = await asyncio.to_thread(engine.generate, request)

    async with SessionFactory() as session:
        async with session.begin():
            asset = await create_audio_asset(
                session,
                workspace_id=ctx.workspace_id,
                owner_id=ctx.owner_id,
                project_id=ctx.project_id,
                voice_id=ctx.voice_id,
                model_installation_id=None,
                generation_job_id=ctx.job_id,
                source_path=result.audio_path,
                title=f"Generated {ctx.job_id.hex[:8]}",
            )
            asset_id = asset.id
            duration = asset.duration_seconds
    await _complete_job(ctx.job_id, asset_id, duration)


async def _run_long_form(ctx: _JobContext, manager: ModelManager) -> None:
    settings = get_settings()

    chunks = chunk_text(
        ctx.text,
        target_chars=settings.longform_chunk_target_chars,
        max_chars=settings.longform_chunk_max_chars,
    )
    if not chunks:
        raise RuntimeError("Text produced no chunks.")

    # Persist chunk records exactly once.
    async with SessionFactory() as session:
        async with session.begin():
            existing = (
                await session.scalars(
                    select(GenerationChunk).where(GenerationChunk.job_id == ctx.job_id)
                )
            ).all()
            if not existing:
                for idx, chunk in enumerate(chunks):
                    session.add(
                        GenerationChunk(
                            job_id=ctx.job_id,
                            index=idx,
                            text=chunk,
                            status="pending",
                        )
                    )
    await _update_progress(ctx.job_id, 0, len(chunks))

    engine = await manager.ensure_loaded(ctx.manifest_id)
    if Capability.TEXT_TO_SPEECH not in engine.capabilities():
        raise RuntimeError(f"Engine '{ctx.manifest_id}' does not support text_to_speech.")

    chunk_dir = settings.temp_dir / "chunks" / ctx.job_id.hex
    chunk_dir.mkdir(parents=True, exist_ok=True)

    completed_paths: list[Path] = []
    for idx, text_chunk in enumerate(chunks):
        if await _is_cancelled(ctx.job_id):
            await _cancel_job(ctx.job_id)
            return

        chunk_path = chunk_dir / f"{idx:04d}.wav"
        request = TTSRequest(
            text=text_chunk,
            language=ctx.language,
            voice_id=ctx.voice_identifier,
            settings=ctx.settings,
            output_path=chunk_path,
        )

        try:
            result = await asyncio.to_thread(engine.generate, request)
        except Exception as exc:
            async with SessionFactory() as session:
                async with session.begin():
                    row = await session.scalar(
                        select(GenerationChunk)
                        .where(GenerationChunk.job_id == ctx.job_id)
                        .where(GenerationChunk.index == idx)
                    )
                    if row is not None:
                        row.status = "failed"
                        row.error_message = str(exc)[:1000]
                        row.attempts += 1
            raise

        async with SessionFactory() as session:
            async with session.begin():
                row = await session.scalar(
                    select(GenerationChunk)
                    .where(GenerationChunk.job_id == ctx.job_id)
                    .where(GenerationChunk.index == idx)
                )
                if row is not None:
                    row.status = "completed"
                    row.storage_path = str(result.audio_path)
                    row.duration_seconds = result.duration_seconds
                    row.attempts += 1

        completed_paths.append(result.audio_path)
        await _update_progress(ctx.job_id, idx + 1, len(chunks))
        _write_heartbeat()

    if not completed_paths:
        raise RuntimeError("No chunks were successfully generated.")

    merged_path = settings.generated_audio_dir / f"long_{ctx.job_id.hex}.wav"
    duration = merge_wav_files(
        completed_paths,
        merged_path,
        pause_ms=settings.longform_pause_ms,
    )

    async with SessionFactory() as session:
        async with session.begin():
            asset = await create_audio_asset(
                session,
                workspace_id=ctx.workspace_id,
                owner_id=ctx.owner_id,
                project_id=ctx.project_id,
                voice_id=ctx.voice_id,
                generation_job_id=ctx.job_id,
                source_path=merged_path,
                title=f"Long-form {ctx.job_id.hex[:8]}",
            )
            asset_id = asset.id
    await _complete_job(ctx.job_id, asset_id, duration)

    # Clean up per-chunk files now that the merged file exists.
    for path in completed_paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


async def _process_job(job_id: uuid.UUID, manager: ModelManager) -> None:
    ctx = await _load_job_context(job_id)
    if ctx is None:
        log.warning("job_missing_on_dispatch", job_id=str(job_id))
        return

    log.info(
        "job_start",
        job_id=str(job_id),
        manifest_id=ctx.manifest_id,
        long_form=ctx.is_long_form,
        chars=len(ctx.text),
    )

    try:
        if ctx.is_long_form:
            await _run_long_form(ctx, manager)
        else:
            await _run_single(ctx, manager)
        log.info("job_complete", job_id=str(job_id))
    except asyncio.CancelledError:
        await _cancel_job(job_id)
        raise
    except ModelLifecycleError as exc:
        log.error("job_model_error", job_id=str(job_id), error=str(exc))
        await _fail_job(job_id, "MODEL_LOAD_FAILED", str(exc))
    except RuntimeError as exc:
        log.error("job_runtime_error", job_id=str(job_id), error=str(exc))
        await _fail_job(job_id, "GENERATION_FAILED", str(exc))
    except Exception as exc:
        log.exception("job_unhandled_error", job_id=str(job_id))
        await _fail_job(job_id, "GENERATION_FAILED", f"Unhandled worker error: {exc}")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


async def main() -> None:
    configure_logging()
    settings = get_settings()
    settings.ensure_dirs()

    registry = ManifestRegistry(Path(__file__).resolve().parents[1] / "model_registry" / "manifests")
    manager = ModelManager(registry)
    await manager.start()

    log.info(
        "worker_started",
        manifests=len(registry.all()),
        manifest_errors=list(registry.errors().keys()),
        idle_unload_seconds=manager._idle_timeout,  # type: ignore[attr-defined]
    )

    stop_event = asyncio.Event()

    def _on_signal(_signum: int, _frame: object) -> None:
        log.info("worker_signal_received", signal=_signum)
        stop_event.set()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    try:
        while not stop_event.is_set():
            _write_heartbeat()
            try:
                job_id = await _claim_job()
            except Exception as exc:
                log.warning("claim_job_failed", error=str(exc))
                await asyncio.sleep(settings.inference_worker_poll_seconds)
                continue

            if job_id is None:
                try:
                    await asyncio.wait_for(
                        stop_event.wait(),
                        timeout=settings.inference_worker_poll_seconds,
                    )
                except asyncio.TimeoutError:
                    pass
                continue

            await _process_job(job_id, manager)
    finally:
        log.info("worker_shutdown")
        await manager.stop()


def run() -> None:
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(run())