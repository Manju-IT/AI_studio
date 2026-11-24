"""Requeue orphaned jobs after a worker crash or restart.

Called by the worker on startup, and exposable to admins via the system router.

Rules:
- If a heartbeat file is fresh (< STALE_SECONDS), another worker is likely
  running and we do not touch any running jobs.
- Running jobs with `cancellation_requested = true` become `cancelled`.
- Other running jobs return to `queued`, keeping their `progress_current` so
  completed chunks are reused by the long-form pipeline.
- `loading_model` state is treated the same as `running` (it never persisted
  in this build, but we handle it defensively).
"""

from __future__ import annotations

import time
from pathlib import Path

from sqlalchemy import select

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.session import SessionFactory
from app.models.job import GenerationJob

log = get_logger(__name__)

STALE_SECONDS = 30.0


async def recover_orphaned_jobs(force: bool = False) -> dict[str, int]:
    """Returns counts of jobs requeued and cancelled."""
    settings = get_settings()
    heartbeat_path = Path(settings.temp_dir) / "worker_heartbeat"

    if not force and heartbeat_path.exists():
        try:
            last = float(heartbeat_path.read_text(encoding="utf-8").strip())
            if time.time() - last < STALE_SECONDS:
                log.info("recovery_skipped_active_worker", age=time.time() - last)
                return {"requeued": 0, "cancelled": 0}
        except (OSError, ValueError):
            pass

    requeued = 0
    cancelled = 0
    async with SessionFactory() as session:
        async with session.begin():
            jobs = (
                await session.scalars(
                    select(GenerationJob)
                    .where(GenerationJob.status.in_(["running", "loading_model"]))
                    .with_for_update()
                )
            ).all()
            for job in jobs:
                if job.cancellation_requested:
                    job.status = "cancelled"
                    job.error_code = "JOB_CANCELLED"
                    job.error_message = "Cancelled after worker restart."
                    cancelled += 1
                else:
                    job.status = "queued"
                    job.error_code = None
                    job.error_message = None
                    job.started_at = None
                    # Keep progress_current so completed long-form chunks are not lost.
                    requeued += 1

    if requeued or cancelled:
        log.info("recovery_complete", requeued=requeued, cancelled=cancelled)
    return {"requeued": requeued, "cancelled": cancelled}