from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class AudioAssetOut(ORMModel):
    id: uuid.UUID
    original_filename: str
    mime_type: str
    format: str
    duration_seconds: float
    sample_rate: int
    channels: int
    file_size_bytes: int
    checksum_sha256: str
    title: str | None
    project_id: uuid.UUID | None
    generation_job_id: uuid.UUID | None
    created_at: datetime


class TrimRequest(BaseModel):
    audio_asset_id: uuid.UUID
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)
    title: str | None = Field(default=None, max_length=200)


class MergeRequest(BaseModel):
    audio_asset_ids: list[uuid.UUID] = Field(min_length=2, max_length=50)
    title: str | None = Field(default=None, max_length=200)
    pause_ms: int = Field(default=0, ge=0, le=5000)


class ExportRequest(BaseModel):
    audio_asset_id: uuid.UUID
    format: str = Field(default="mp3", pattern="^(wav|mp3)$")