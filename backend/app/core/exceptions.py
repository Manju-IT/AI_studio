from __future__ import annotations

from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    MODEL_NOT_INSTALLED = "MODEL_NOT_INSTALLED"
    MODEL_NOT_LOADED = "MODEL_NOT_LOADED"
    MODEL_LOAD_FAILED = "MODEL_LOAD_FAILED"
    MODEL_VALIDATION_FAILED = "MODEL_VALIDATION_FAILED"
    CAPABILITY_UNSUPPORTED = "CAPABILITY_UNSUPPORTED"
    UNSUPPORTED_LANGUAGE = "UNSUPPORTED_LANGUAGE"
    INSUFFICIENT_MEMORY = "INSUFFICIENT_MEMORY"
    INSUFFICIENT_DISK_SPACE = "INSUFFICIENT_DISK_SPACE"
    GENERATION_FAILED = "GENERATION_FAILED"
    GENERATION_TIMEOUT = "GENERATION_TIMEOUT"
    JOB_CANCELLED = "JOB_CANCELLED"
    JOB_ALREADY_TERMINAL = "JOB_ALREADY_TERMINAL"
    INVALID_AUDIO = "INVALID_AUDIO"
    PATH_TRAVERSAL = "PATH_TRAVERSAL"
    CONSENT_REQUIRED = "CONSENT_REQUIRED"
    WORKER_UNAVAILABLE = "WORKER_UNAVAILABLE"
    DATABASE_ERROR = "DATABASE_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class AppError(Exception):
    """Base application error. Handlers translate this to a structured JSON response."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {"error": {"code": self.code.value, "message": self.message, "details": self.details}}


class NotFoundError(AppError):
    def __init__(self, resource: str, resource_id: str | int) -> None:
        super().__init__(
            ErrorCode.NOT_FOUND,
            f"{resource} '{resource_id}' was not found.",
            status_code=404,
        )


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Authentication required.") -> None:
        super().__init__(ErrorCode.UNAUTHORIZED, message, status_code=401)


class ForbiddenError(AppError):
    def __init__(self, message: str = "You do not have permission to perform this action.") -> None:
        super().__init__(ErrorCode.FORBIDDEN, message, status_code=403)


class CapabilityUnsupportedError(AppError):
    def __init__(self, capability: str, model_id: str) -> None:
        super().__init__(
            ErrorCode.CAPABILITY_UNSUPPORTED,
            f"Model '{model_id}' does not support the '{capability}' capability.",
            status_code=422,
            details={"capability": capability, "model_id": model_id},
        )


class InsufficientMemoryError(AppError):
    def __init__(self, required_mb: int, available_mb: int) -> None:
        super().__init__(
            ErrorCode.INSUFFICIENT_MEMORY,
            f"Not enough RAM to load the model: need ~{required_mb} MB, {available_mb} MB available.",
            status_code=503,
            details={"required_mb": required_mb, "available_mb": available_mb},
        )