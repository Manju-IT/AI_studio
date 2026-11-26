from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class VoiceSampleOut(ORMModel):
    id: uuid.UUID
    original_filename: str
    duration_seconds: float
    sample_rate: int
    format: str
    file_size_bytes: int
    is_reference: bool


class VoiceAuthorizationOut(ORMModel):
    id: uuid.UUID
    speaker_name: str
    consent_statement: str
    authorized_at: datetime
    authorized_by_user_id: uuid.UUID | None


class VoiceOut(ORMModel):
    synthesis_ready: bool = False
    model_installation_id: uuid.UUID | None = None
    id: uuid.UUID
    name: str
    language: str
    source: str
    description: str | None
    is_favorite: bool
    is_active: bool
    design_prompt: str | None
    created_at: datetime
    samples: list[VoiceSampleOut] = Field(default_factory=list)


class VoiceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    language: str = Field(max_length=10)
    description: str | None = Field(default=None, max_length=2000)


class CloneRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    language: str = Field(max_length=10)
    speaker_name: str = Field(min_length=1, max_length=200)
    consent_statement: str = Field(
        min_length=20,
        max_length=2000,
        description="Free-text statement confirming the speaker authorised this clone.",
    )
    reference_text: str = Field(
        min_length=1,
        max_length=2000,
        description="Verbatim transcript of the reference audio. Required by Qwen MNN extraction.",
    )
    model_installation_id: uuid.UUID | None = None


class DesignRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    language: str = Field(max_length=10)
    description: str = Field(min_length=10, max_length=2000)
    preview_text: str = Field(min_length=1, max_length=500)


class VoiceFavoriteRequest(BaseModel):
    is_favorite: bool