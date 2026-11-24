from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_login_success(client, seeded):
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "ChangeThisPassword123!"},
    )
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "admin@example.com"
    assert "voice_studio_session" in response.cookies


async def test_login_wrong_password(client, seeded):
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "wrong-password"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


async def test_me_requires_cookie(client):
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


async def test_me_returns_user_when_authenticated(admin_client):
    response = await admin_client.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["role"] == "admin"