"""Recover interrupted jobs without replaying native crashes automatically."""
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import select
from app.core.config import get_settings
from app.db.session import SessionFactory
from app.models.job import GenerationJob
from app.services.jobs.worker_lock import worker_lock

async def recover_orphaned_jobs(force: bool = False) -> dict[str, int]:
    # force is reserved for the worker already holding the OS lock.
    if force:
        return await _recover()
    with worker_lock(Path(get_settings().temp_dir) / "worker.lock") as acquired:
        if not acquired:
            return {"requeued": 0, "cancelled": 0, "failed": 0}
        return await _recover()

async def _recover() -> dict[str, int]:
    counts = {"requeued": 0, "cancelled": 0, "failed": 0}
    async with SessionFactory() as session:
        async with session.begin():
            jobs = (await session.scalars(select(GenerationJob).where(
                GenerationJob.status.in_(["running", "loading_model"])
            ).with_for_update())).all()
            for job in jobs:
                job.finished_at = datetime.now(timezone.utc)
                if job.cancellation_requested:
                    job.status = "cancelled"
                    job.error_code = "JOB_CANCELLED"
                    job.error_message = "Cancelled after worker interruption."
                else:
                    job.status = "failed"
                    job.error_code = "WORKER_INTERRUPTED"
                    job.error_message = "Worker stopped during generation. Retry manually."
                counts[job.status] += 1
    return counts
