from __future__ import annotations

import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.core.config import get_settings
from app.core.exceptions import UnauthorizedError


@dataclass(frozen=True)
class SessionPayload:
    user_id: str
    role: str
    issued_at: datetime


def _password_hasher() -> PasswordHasher:
    s = get_settings()
    return PasswordHasher(
        time_cost=s.argon2_time_cost,
        memory_cost=s.argon2_memory_cost,
        parallelism=s.argon2_parallelism,
    )


def hash_password(plain: str) -> str:
    if len(plain) < 10:
        raise ValueError("Password must be at least 10 characters.")
    return _password_hasher().hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _password_hasher().verify(hashed, plain)
    except VerifyMismatchError:
        return False


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().secret_key, salt="voice-studio-session")


def create_session_token(user_id: str, role: str) -> str:
    payload: dict[str, Any] = {
        "uid": user_id,
        "role": role,
        "jti": secrets.token_hex(8),
    }
    return _serializer().dumps(payload)


def decode_session_token(token: str) -> SessionPayload:
    s = get_settings()
    try:
        data = _serializer().loads(token, max_age=s.session_max_age_seconds)
    except BadSignature as exc:
        raise UnauthorizedError("Invalid or expired session.") from exc
    return SessionPayload(
        user_id=str(data["uid"]),
        role=str(data["role"]),
        issued_at=datetime.now(timezone.utc) - timedelta(seconds=s.session_max_age_seconds / 2),
    )


def constant_time_compare(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())