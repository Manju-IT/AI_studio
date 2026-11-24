from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import admin_user, current_user, db_session
from app.core.exceptions import AppError, ErrorCode, NotFoundError, UnauthorizedError
from app.core.security import create_session_token, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    UserAdminUpdate,
    UserCreate,
    UserPublic,
)

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    session: AsyncSession = Depends(db_session),
) -> LoginResponse:
    user = await session.scalar(select(User).where(User.email == payload.email.lower()))
    dummy_hash = "$argon2id$v=19$m=65536,t=3,p=2$ZHVtbXlkdW1teWR1bW15$ZHVtbXlkdW1teWR1bW15ZHVtbXk"
    candidate_hash = user.password_hash if user else dummy_hash
    if not verify_password(payload.password, candidate_hash) or user is None or not user.is_active:
        raise UnauthorizedError("Invalid email or password.")

    token = create_session_token(str(user.id), user.role)
    response.set_cookie(
        key="voice_studio_session",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=86400,
        path="/",
    )
    return LoginResponse(user=UserPublic.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> Response:
    response.delete_cookie("voice_studio_session", path="/")
    return response


@router.get("/me", response_model=UserPublic)
async def me(user: User = Depends(current_user)) -> UserPublic:
    return UserPublic.model_validate(user)


@router.get("/users", response_model=list[UserPublic])
async def list_users(
    _: User = Depends(admin_user),
    session: AsyncSession = Depends(db_session),
) -> list[UserPublic]:
    rows = (await session.scalars(select(User).order_by(User.created_at))).all()
    return [UserPublic.model_validate(r) for r in rows]


@router.post("/users", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    admin: User = Depends(admin_user),
    session: AsyncSession = Depends(db_session),
) -> UserPublic:
    existing = await session.scalar(select(User).where(User.email == payload.email.lower()))
    if existing is not None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"A user with email '{payload.email}' already exists.",
            status_code=409,
        )
    user = User(
        email=payload.email.lower(),
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return UserPublic.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserPublic)
async def update_user(
    user_id: uuid.UUID,
    payload: UserAdminUpdate,
    admin: User = Depends(admin_user),
    session: AsyncSession = Depends(db_session),
) -> UserPublic:
    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("User", str(user_id))

    # Prevent the last admin from demoting or deactivating themselves.
    if user.id == admin.id and (payload.role == "member" or payload.is_active is False):
        admin_count = len(
            (await session.scalars(select(User).where(User.role == "admin"))).all()
        )
        if admin_count <= 1:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                "At least one active admin must remain.",
                status_code=409,
            )

    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active

    await session.commit()
    await session.refresh(user)
    return UserPublic.model_validate(user)


@router.post("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: uuid.UUID,
    payload: dict,
    admin: User = Depends(admin_user),
    session: AsyncSession = Depends(db_session),
) -> None:
    password = payload.get("password")
    if not isinstance(password, str) or len(password) < 10:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "Password must be at least 10 characters.",
            status_code=422,
        )
    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("User", str(user_id))
    user.password_hash = hash_password(password)
    await session.commit()


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(
    user_id: uuid.UUID,
    admin: User = Depends(admin_user),
    session: AsyncSession = Depends(db_session),
) -> None:
    if user_id == admin.id:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "You cannot deactivate your own account.",
            status_code=409,
        )
    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("User", str(user_id))
    user.is_active = False
    await session.commit()