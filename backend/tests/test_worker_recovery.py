from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models.job import GenerationJob
from app.models.model import ModelDefinition, ModelInstallation
from app.models.user import User, Workspace
from app.services.jobs.recovery import recover_orphaned_jobs

pytestmark = pytest.mark.asyncio


async def _seed_job(session, workspace, user, status: str, cancel: bool = False):
    definition = ModelDefinition(
        slug=f"arch-{uuid.uuid4().hex[:6]}",
        display_name="Arch",
        architecture="kokoro",
        model_type="lightweight",
        parameters_billions=0.082,
        license="Apache-2.0",
        source_repository="https://example.invalid",
        languages=["en"],
        capabilities={"text_to_speech": True},
    )
    session.add(definition)
    await session.flush()
    installation = ModelInstallation(
        definition_id=definition.id,
        manifest_id=f"manifest-{uuid.uuid4().hex[:6]}",
        runtime="kokoro",
        device="cpu",
        model_path="/tmp/m",
    )
    session.add(installation)
    await session.flush()

    job = GenerationJob(
        workspace_id=workspace.id,
        created_by_user_id=user.id,
        model_installation_id=installation.id,
        status=status,
        text="hi",
        language="en",
        cancellation_requested=cancel,
    )
    session.add(job)
    await session.commit()
    return job


async def test_recovery_requeues_orphaned_running_jobs(db_session, seeded, tmp_path):
    workspace = seeded["workspace"]
    user = seeded["admin"]
    job = await _seed_job(db_session, workspace, user, "running")

    # Force force=True so recovery runs even if a heartbeat exists.
    result = await recover_orphaned_jobs(force=True)
    assert result["requeued"] == 1

    refreshed = await db_session.scalar(select(GenerationJob).where(GenerationJob.id == job.id))
    assert refreshed is not None
    await db_session.refresh(refreshed)
    assert refreshed.status == "queued"
    assert refreshed.started_at is None


async def test_recovery_cancels_requested_jobs(db_session, seeded):
    workspace = seeded["workspace"]
    user = seeded["admin"]
    job = await _seed_job(db_session, workspace, user, "running", cancel=True)

    result = await recover_orphaned_jobs(force=True)
    assert result["cancelled"] == 1

    refreshed = await db_session.scalar(select(GenerationJob).where(GenerationJob.id == job.id))
    assert refreshed is not None
    await db_session.refresh(refreshed)
    assert refreshed.status == "cancelled"