"""Inference worker process.

Runs a persistent loop that:
1. On startup, recovers orphaned jobs.
2. Writes a heartbeat file so the API can report liveness.
3. Atomically claims queued jobs with SELECT ... FOR UPDATE SKIP LOCKED.
4. Ensures the model is loaded via ModelManager (unloads the previous one).
5. Generates audio under a wall-clock timeout. On timeout the worker fails the
   job and exits, because asyncio cannot cancel a thread spawned by to_thread.
6. On shutdown, cleans stale temporary chunk files.
"""

from __future__ import annotations

import asyncio
from inference.voice_assets import usable, profile_path
import os
import signal
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text, update

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.session import SessionFactory
from app.models.job import GenerationChunk, GenerationJob
from app.models.model import ModelInstallation
from app.models.voice import Voice
from app.services.audio.assets import create_audio_asset
from app.services.audio.chunker import chunk_text, merge_wav_files
from app.services.jobs.recovery import recover_orphaned_jobs
from app.services.jobs.worker_lock import worker_lock
from inference.contracts.types import Capability, TTSRequest
from inference.manager.loader import ModelLifecycleError, ModelManager
from inference.manager.registry import ManifestRegistry

log = get_logger("worker")


def _write_heartbeat() -> None:
    settings = get_settings()
    path = Path(settings.temp_dir) / "worker_heartbeat"
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(str(time.time()), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass


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


async def _sync_model_state(manager: ModelManager) -> None:
    """Reconcile DB model status with the model actually held by this worker."""
    active = manager.active_manifest_id()
    async with SessionFactory() as session:
        async with session.begin():
            rows = (await session.scalars(select(ModelInstallation))).all()
            for row in rows:
                if row.loading_state in ("loading", "unloading"):
                    continue  # Pending command; processed separately.
                if row.manifest_id == active:
                    row.loading_state = "loaded"
                    row.is_active_model = True
                else:
                    if row.loading_state == "loaded":
                        row.loading_state = "unloaded"
                    row.is_active_model = False


async def _process_model_commands(manager: ModelManager) -> None:
    """Run requested model transitions in the worker, not the API process.

    This is intended for ONE local inference worker. Do not launch two workers.
    """
    async with SessionFactory() as session:
        pending = (await session.scalars(
            select(ModelInstallation)
            .where(ModelInstallation.loading_state.in_(("unloading", "loading")))
            .order_by(ModelInstallation.updated_at.asc())
        )).all()
        commands = [(row.manifest_id, row.loading_state) for row in pending]

    for manifest_id, command in commands:
        # Verify request is still pending; UI may have changed it while we waited.
        async with SessionFactory() as session:
            row = await session.scalar(select(ModelInstallation).where(ModelInstallation.manifest_id == manifest_id))
            if row is None or row.loading_state != command:
                continue
        try:
            if command == "loading":
                await manager.ensure_loaded(manifest_id)
            elif manager.active_manifest_id() == manifest_id:
                await manager.unload()
        except Exception as exc:
            log.exception("model_command_failed", manifest_id=manifest_id, command=command)
            async with SessionFactory() as session:
                async with session.begin():
                    row = await session.scalar(select(ModelInstallation).where(ModelInstallation.manifest_id == manifest_id).with_for_update())
                    if row is not None and row.loading_state == command:
                        row.loading_state = "error"
                        row.last_error = str(exc)[:2000]
                        row.is_active_model = False
        else:
            async with SessionFactory() as session:
                async with session.begin():
                    row = await session.scalar(select(ModelInstallation).where(ModelInstallation.manifest_id == manifest_id).with_for_update())
                    if row is not None and row.loading_state == command:
                        row.loading_state = "loaded" if command == "loading" else "unloaded"
                        row.is_active_model = command == "loading"
                        row.last_error = None
                        if command == "loading":
                            row.last_loaded_at = datetime.now(timezone.utc)
        await _sync_model_state(manager)


async def _claim_job() -> uuid.UUID | None:
    async with SessionFactory() as session:
        async with session.begin():
            row = (await session.execute(_CLAIM_SQL)).first()
            return row[0] if row is not None else None


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
            if job is not None:
                job.progress_current = current
                job.progress_total = total


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
        if job.voice_id and (voice is None or not voice.is_active or not usable(voice, job.created_by_user_id, installation) or voice.owner_id not in (None, job.created_by_user_id)):
            raise RuntimeError("Voice is unavailable or has not been integrated for synthesis.")
        return _JobContext(
            job_id=job.id,
            workspace_id=job.workspace_id,
            owner_id=job.created_by_user_id,
            manifest_id=installation.manifest_id,
            text=job.text,
            language=job.language,
            voice_id=job.voice_id,
            voice_identifier=(str(profile_path(voice.id).resolve()) if voice.source == "cloned" else voice.name) if voice else None,
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
            if job is not None:
                job.status = "failed"
                job.error_code = code
                job.error_message = message[:2000]
                job.finished_at = datetime.now(timezone.utc)


async def _complete_job(job_id: uuid.UUID, asset_id: uuid.UUID, duration: float) -> None:
    async with SessionFactory() as session:
        async with session.begin():
            job = await session.scalar(
                select(GenerationJob).where(GenerationJob.id == job_id).with_for_update()
            )
            if job is not None:
                job.status = "completed"
                job.finished_at = datetime.now(timezone.utc)
                job.audio_asset_id = asset_id
                job.duration_seconds = duration
                job.progress_current = job.progress_total


async def _cancel_job(job_id: uuid.UUID) -> None:
    async with SessionFactory() as session:
        async with session.begin():
            job = await session.scalar(
                select(GenerationJob).where(GenerationJob.id == job_id).with_for_update()
            )
            if job is not None:
                job.status = "cancelled"
                job.finished_at = datetime.now(timezone.utc)


async def _run_with_timeout(
    fn: Any, *args: Any, timeout: float, label: str, job_id: uuid.UUID
) -> Any:
    """Run a blocking callable in a thread with a wall-clock timeout.

    If the timeout fires, the thread continues running (Python cannot cancel it),
    so we mark the job failed and terminate this worker process. The process
    controller or supervisor restarts it; recovery requeues any other running
    job that was interrupted.
    """
    settings = get_settings()
    loop = asyncio.get_running_loop()
    future = loop.run_in_executor(None, fn, *args)
    try:
        return await asyncio.wait_for(future, timeout=timeout)
    except asyncio.TimeoutError:
        log.error(
            "generation_timeout",
            job_id=str(job_id),
            label=label,
            timeout=timeout,
        )
        await _fail_job(
            job_id,
            "GENERATION_TIMEOUT",
            f"{label} exceeded {timeout:.0f}s wall-clock limit. "
            "The worker will restart to clear the hung thread.",
        )
        # A non-zero exit is the only reliable way to free a stuck thread.
        os._exit(1)


async def _run_single(ctx: _JobContext, manager: ModelManager) -> None:
    engine = await manager.ensure_loaded(ctx.manifest_id)
    if Capability.TEXT_TO_SPEECH not in engine.capabilities():
        raise RuntimeError(f"Engine '{ctx.manifest_id}' does not support text_to_speech.")

    if await _is_cancelled(ctx.job_id):
        await _cancel_job(ctx.job_id)
        return

    settings = get_settings()
    out_path = settings.generated_audio_dir / f"single_{ctx.job_id.hex}.wav"
    request = TTSRequest(
        text=ctx.text,
        language=ctx.language,
        voice_id=ctx.voice_identifier,
        settings=ctx.settings,
        output_path=out_path,
    )
    result = await _run_with_timeout(
        engine.generate,
        request,
        timeout=settings.inference_generation_timeout_seconds,
        label="single generation",
        job_id=ctx.job_id,
    )

    if await _is_cancelled(ctx.job_id):
        await _cancel_job(ctx.job_id)
        try:
            result.audio_path.unlink(missing_ok=True)
        except OSError:
            pass
        return

    async with SessionFactory() as session:
        async with session.begin():
            asset = await create_audio_asset(
                session,
                workspace_id=ctx.workspace_id,
                owner_id=ctx.owner_id,
                project_id=ctx.project_id,
                voice_id=ctx.voice_id,
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
                        GenerationChunk(job_id=ctx.job_id, index=idx, text=chunk, status="pending")
                    )

    async with SessionFactory() as session:
        rows = (
            await session.scalars(
                select(GenerationChunk).where(GenerationChunk.job_id == ctx.job_id)
            )
        ).all()
    completed = {
        r.index: Path(r.storage_path)
        for r in rows
        if r.status == "completed" and r.storage_path and Path(r.storage_path).exists()
    }

    await _update_progress(ctx.job_id, len(completed), len(chunks))

    engine = await manager.ensure_loaded(ctx.manifest_id)
    if Capability.TEXT_TO_SPEECH not in engine.capabilities():
        raise RuntimeError(f"Engine '{ctx.manifest_id}' does not support text_to_speech.")

    chunk_dir = settings.temp_dir / "chunks" / ctx.job_id.hex
    chunk_dir.mkdir(parents=True, exist_ok=True)

    completed_paths: list[Path] = []
    for idx, text_chunk in enumerate(chunks):
        if idx in completed:
            completed_paths.append(completed[idx])
            continue
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
            result = await _run_with_timeout(
                engine.generate,
                request,
                timeout=settings.inference_chunk_timeout_seconds,
                label=f"chunk {idx + 1}/{len(chunks)}",
                job_id=ctx.job_id,
            )
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
        await _update_progress(ctx.job_id, len(completed_paths), len(chunks))
        _write_heartbeat()

    if not completed_paths:
        raise RuntimeError("No chunks were successfully generated.")

    merged_path = settings.generated_audio_dir / f"long_{ctx.job_id.hex}.wav"
    duration = merge_wav_files(completed_paths, merged_path, pause_ms=settings.longform_pause_ms)

    if await _is_cancelled(ctx.job_id):
        await _cancel_job(ctx.job_id)
        try:
            merged_path.unlink(missing_ok=True)
        except OSError:
            pass
        return

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

    for path in completed_paths:
        if path != merged_path:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


async def _process_job(job_id: uuid.UUID, manager: ModelManager) -> None:
    try:
        ctx = await _load_job_context(job_id)
    except RuntimeError as exc:
        log.error("job_context_error", job_id=str(job_id), error=str(exc))
        await _fail_job(job_id, "GENERATION_FAILED", str(exc))
        return
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


def _cleanup_stale_temp() -> None:
    """Remove chunk files for jobs that no longer exist or are older than 24h."""
    import time as _time

    settings = get_settings()
    chunks_root = Path(settings.temp_dir) / "chunks"
    if not chunks_root.exists():
        return
    cutoff = _time.time() - 86400
    for job_dir in chunks_root.iterdir():
        if not job_dir.is_dir():
            continue
        try:
            if job_dir.stat().st_mtime < cutoff:
                import shutil

                shutil.rmtree(job_dir, ignore_errors=True)
        except OSError:
            pass


async def main() -> None:
    configure_logging()
    settings = get_settings()
    settings.ensure_dirs()

    try:
        recovery = await recover_orphaned_jobs(force=True)
        log.info("worker_startup_recovery", **recovery)
    except Exception as exc:
        log.warning("worker_startup_recovery_failed", error=str(exc))
        raise

    from app.services.jobs.local_queue import recover, pending
    from inference.local_jobs import process
    while True:
        with worker_lock(settings.temp_dir / 'heavy_child.lock') as free:
            if free:
                recover()
                break
        await asyncio.sleep(1)
    _cleanup_stale_temp()

    # A process restart loses all in-memory models. Clear stale states.
    async with SessionFactory() as session:
        async with session.begin():
            await session.execute(
                update(ModelInstallation)
                .values(loading_state="unloaded", is_active_model=False)
            )

    registry = ManifestRegistry(
        Path(__file__).resolve().parents[1] / "model_registry" / "manifests"
    )
    manager = ModelManager(registry)
    await manager.start()
    log.info(
        "worker_started",
        manifests=len(registry.all()),
        manifest_errors=list(registry.errors().keys()),
        generation_timeout=settings.inference_generation_timeout_seconds,
        chunk_timeout=settings.inference_chunk_timeout_seconds,
    )

    stop_event = asyncio.Event()

    def _on_signal(_signum: int, _frame: object) -> None:
        log.info("worker_signal_received", signal=_signum)
        stop_event.set()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    async def heartbeat_loop():
        while True:
            _write_heartbeat()
            await asyncio.sleep(2)

    heartbeat_task = asyncio.create_task(heartbeat_loop())
    local_streak = 0
    try:
        while not stop_event.is_set():
            _write_heartbeat()
            with worker_lock(settings.temp_dir / 'heavy_child.lock') as free:
                child_busy = not free
            if child_busy:
                await asyncio.sleep(1)
                continue
            local = pending()
            if local is not None and local_streak < 1:
                local_streak += 1
                await manager.unload()
                await _sync_model_state(manager)
                await process(*local)
                continue
            try:
                await _process_model_commands(manager)
                await _sync_model_state(manager)
            except Exception as exc:
                log.exception("model_command_poll_failed", error=str(exc))
            try:
                job_id = await _claim_job()
            except Exception as exc:
                log.warning("claim_job_failed", error=str(exc))
                await asyncio.sleep(settings.inference_worker_poll_seconds)
                continue

            local_streak = 0
            if job_id is None and local is not None:
                continue
            if job_id is None:
                await manager.unload_if_idle()
                await _sync_model_state(manager)
                try:
                    await asyncio.wait_for(
                        stop_event.wait(), timeout=settings.inference_worker_poll_seconds
                    )
                except asyncio.TimeoutError:
                    pass
                continue

            await _process_job(job_id, manager)
            manager.touch()
            await _sync_model_state(manager)
    finally:
        heartbeat_task.cancel()
        await asyncio.gather(heartbeat_task, return_exceptions=True)
        log.info("worker_shutdown")
        await manager.stop()


def run() -> int | None:
    try:
        with worker_lock(Path(get_settings().temp_dir) / "worker.lock") as acquired:
            if not acquired:
                print("Another inference worker is active.", flush=True)
                return 73
            try:
                asyncio.run(main())
            finally:
                (Path(get_settings().temp_dir) / "worker_heartbeat").unlink(missing_ok=True)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(run())