"""Pytest fixtures for API + service tests.

DB-backed tests require `TEST_DATABASE_URL` pointing at a PostgreSQL 16
database dedicated to testing. They are skipped if the variable is unset,
so developers without a test DB can still run the pure-unit tests.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import numpy as np
import pytest
import pytest_asyncio
import soundfile as sf
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.security import hash_password
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.user import User, Workspace, WorkspaceMember

TEST_URL = os.environ.get("TEST_DATABASE_URL")


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    if not TEST_URL:
        pytest.skip("TEST_DATABASE_URL not set; skipping DB-backed tests.")
    engine = create_async_engine(TEST_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def clean_tables(test_engine):
    """Truncate every table between tests. Fast and deterministic."""
    yield
    async with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession) -> dict[str, User | Workspace]:
    workspace = Workspace(name="Test Workspace", slug="test")
    db_session.add(workspace)
    await db_session.flush()

    admin = User(
        email="aadmin@example.com",
        display_name="Admin",
        password_hash=hash_password("ChangeThisPassword123!"),
        role="admin",
        is_active=True,
    )
    member = User(
        email="member@test.local",
        display_name="Member",
        password_hash=hash_password("ChangeThisPassword123!"),
        role="member",
        is_active=True,
    )
    db_session.add_all([admin, member])
    await db_session.flush()

    db_session.add_all(
        [
            WorkspaceMember(workspace_id=workspace.id, user_id=admin.id, role="admin"),
            WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"),
        ]
    )
    await db_session.commit()
    return {"workspace": workspace, "admin": admin, "member": member}


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app()

    async def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def admin_client(client: AsyncClient, seeded) -> AsyncClient:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "ChangeThisPassword123!"},
    )
    assert response.status_code == 200, response.text
    return client


@pytest.fixture
def wav_file(tmp_path):
    """Return a factory producing 5s sine-wave WAVs of the requested duration."""

    def _make(duration: float = 5.0, sample_rate: int = 24000) -> str:
        path = tmp_path / f"ref_{duration}s.wav"
        t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
        data = (0.1 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
        sf.write(str(path), data, sample_rate, subtype="PCM_16")
        return str(path)

    return _make