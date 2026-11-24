from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.core.security import decode_session_token
from app.db.session import get_db
from app.models.user import User


async def db_session() -> AsyncIterator[AsyncSession]:
    async for session in get_db():
        yield session


async def current_user(
    request: Request,
    session: AsyncSession = Depends(db_session),
) -> User:
    token = request.cookies.get("voice_studio_session")
    if not token:
        raise UnauthorizedError("Missing session cookie.")
    payload = decode_session_token(token)
    user = await session.scalar(select(User).where(User.id == payload.user_id))
    if user is None or not user.is_active:
        raise UnauthorizedError("User account is inactive or missing.")
    return user


async def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise ForbiddenError("Administrator role required.")
    return user