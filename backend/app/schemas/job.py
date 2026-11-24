from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.audio import AudioAssetOut


class GenerationChunkOut(ORMModel):
    id: uuid.UUID
    index: int
    text: str
    status: str
    duration_seconds: float | None
    error_message: str | None
    attempts: int


class GenerationJobOut(ORMModel):
    id: uuid.UUID
    model_installation_id: uuid.UUID | None
    voice_id: uuid.UUID | None
    project_id: uuid.UUID | None
    status: str
    text: str
    language: str
    settings: dict[str, Any]
    is_long_form: bool
    progress_current: int
    progress_total: int
    error_code: str | None
    error_message: str | None
    started_at: datetime | None
    finished_at: datetime | None
    cancellation_requested: bool
    duration_seconds: float | None
    audio_asset_id: uuid.UUID | None
    created_at: datetime
    audio_asset: AudioAssetOut | None = None
    chunks: list[GenerationChunkOut] = Field(default_factory=list)


class JobCancelResponse(BaseModel):
    id: uuid.UUID
    status: str
    cancellation_requested: bool


class GenerationSubmitRequest(BaseModel):
    model_installation_id: uuid.UUID
    voice_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    text: str = Field(min_length=1, max_length=50000)
    language: str = Field(default="en", max_length=10)
    settings: dict[str, Any] = Field(default_factory=dict)
    long_form: bool = False
    idempotency_key: str | None = Field(
        default=None,
        max_length=128,
        description="Optional client-supplied key. Repeated submissions return the first job.",
    )