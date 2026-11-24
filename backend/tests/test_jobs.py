from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.job import GenerationJob
from app.models.model import ModelDefinition, ModelInstallation

pytestmark = pytest.mark.asyncio


async def _seed_installation(session, workspace):
    definition = ModelDefinition(
        slug="test-kokoro",
        display_name="Test Kokoro",
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
        manifest_id="test-kokoro-q8",
        runtime="kokoro",
        quantization="q8",
        device="cpu",
        model_path="/tmp/kokoro",
        memory_estimate_mb=350,
    )
    session.add(installation)
    await session.commit()
    return installation


async def test_submit_generation_creates_queued_job(admin_client, seeded, db_session):
    installation = await _seed_installation(db_session, seeded["workspace"])

    response = await admin_client.post(
        "/api/v1/generations",
        json={
            "model_installation_id": str(installation.id),
            "text": "Hello world",
            "language": "en",
            "settings": {},
            "long_form": False,
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "queued"
    assert body["text"] == "Hello world"


async def test_cancel_queued_job(admin_client, seeded, db_session):
    installation = await _seed_installation(db_session, seeded["workspace"])
    submit = await admin_client.post(
        "/api/v1/generations",
        json={
            "model_installation_id": str(installation.id),
            "text": "Cancel me",
            "language": "en",
        },
    )
    job_id = submit.json()["id"]

    response = await admin_client.post(f"/api/v1/generations/{job_id}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


async def test_cancel_terminal_job_returns_409(admin_client, seeded, db_session):
    installation = await _seed_installation(db_session, seeded["workspace"])
    submit = await admin_client.post(
        "/api/v1/generations",
        json={
            "model_installation_id": str(installation.id),
            "text": "Already done",
            "language": "en",
        },
    )
    job_id = submit.json()["id"]

    job = await db_session.scalar(select(GenerationJob).where(GenerationJob.id == uuid.UUID(job_id)))
    assert job is not None
    job.status = "completed"
    await db_session.commit()

    response = await admin_client.post(f"/api/v1/generations/{job_id}/cancel")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "JOB_ALREADY_TERMINAL"


async def test_retry_creates_new_queued_job(admin_client, seeded, db_session):
    installation = await _seed_installation(db_session, seeded["workspace"])
    submit = await admin_client.post(
        "/api/v1/generations",
        json={
            "model_installation_id": str(installation.id),
            "text": "Retry me",
            "language": "en",
        },
    )
    job_id = submit.json()["id"]

    job = await db_session.scalar(select(GenerationJob).where(GenerationJob.id == uuid.UUID(job_id)))
    assert job is not None
    job.status = "failed"
    job.error_message = "boom"
    await db_session.commit()

    response = await admin_client.post(f"/api/v1/jobs/{job_id}/retry")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert body["text"] == "Retry me"
    assert body["id"] != job_id