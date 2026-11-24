from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def _create_cloned_voice(admin_client):
    response = await admin_client.post(
        "/api/v1/voices/clone",
        json={
            "name": "Test Voice",
            "language": "en",
            "speaker_name": "Test Speaker",
            "consent_statement": "I confirm this speaker authorised the clone for internal use.",
            "reference_text": "The quick brown fox jumps over the lazy dog.",
        },
    )
    return response


async def test_clone_requires_consent(admin_client):
    response = await admin_client.post(
        "/api/v1/voices/clone",
        json={
            "name": "Missing Consent",
            "language": "en",
            "speaker_name": "X",
            "consent_statement": "short",
            "reference_text": "abc",
        },
    )
    assert response.status_code == 422


async def test_clone_persists_authorization(admin_client):
    response = await _create_cloned_voice(admin_client)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["source"] == "cloned"
    assert body["name"] == "Test Voice"


async def test_upload_reference_rejects_short_audio(admin_client, wav_file):
    voice = (await _create_cloned_voice(admin_client)).json()
    short = wav_file(duration=0.5)

    with open(short, "rb") as fh:
        response = await admin_client.post(
            f"/api/v1/voices/{voice['id']}/reference",
            files={"file": ("short.wav", fh, "audio/wav")},
        )
    assert response.status_code == 422
    assert "too short" in response.json()["error"]["message"]


async def test_upload_reference_rejects_bad_extension(admin_client, tmp_path):
    voice = (await _create_cloned_voice(admin_client)).json()
    bogus = tmp_path / "ref.txt"
    bogus.write_text("not audio")

    with bogus.open("rb") as fh:
        response = await admin_client.post(
            f"/api/v1/voices/{voice['id']}/reference",
            files={"file": ("ref.txt", fh, "text/plain")},
        )
    assert response.status_code == 422


async def test_upload_reference_persists_sample(admin_client, wav_file):
    voice = (await _create_cloned_voice(admin_client)).json()
    ref = wav_file(duration=3.0)

    with open(ref, "rb") as fh:
        response = await admin_client.post(
            f"/api/v1/voices/{voice['id']}/reference",
            files={"file": ("ref.wav", fh, "audio/wav")},
        )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["is_reference"] is True
    assert body["duration_seconds"] > 2.5
    assert body["sample_rate"] == 24000