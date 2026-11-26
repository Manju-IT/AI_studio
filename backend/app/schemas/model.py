from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class ModelDefinitionOut(ORMModel):
    id: uuid.UUID
    slug: str
    display_name: str
    architecture: str
    model_type: str
    parameters_billions: float
    license: str
    source_repository: str
    languages: list[str]
    capabilities: dict[str, Any]


class ModelInstallationOut(ORMModel):
    id: uuid.UUID
    definition_id: uuid.UUID
    manifest_id: str
    runtime: str
    quantization: str | None
    device: str
    model_path: str
    memory_estimate_mb: int | None
    installation_state: str
    loading_state: str
    last_error: str | None
    last_loaded_at: datetime | None
    is_active_model: bool
    definition: ModelDefinitionOut
    generation_contract: dict[str, Any] = Field(default_factory=dict)


class ModelRegisterRequest(BaseModel):
    definition_slug: str = Field(min_length=2, max_length=120)
    manifest_id: str = Field(min_length=2, max_length=160)
    runtime: str
    quantization: str | None = None
    device: str = "cpu"
    model_path: str
    memory_estimate_mb: int | None = None


class ModelValidateResponse(BaseModel):
    manifest_id: str
    valid: bool
    errors: list[str] = Field(default_factory=list)


class ModelLoadResponse(BaseModel):
    manifest_id: str
    state: str


class BenchmarkOut(ORMModel):
    id: uuid.UUID
    installation_id: uuid.UUID
    sample_name: str
    text_length_chars: int
    generation_time_seconds: float
    audio_duration_seconds: float
    real_time_factor: float
    time_to_first_audio_seconds: float | None
    peak_ram_mb: int | None
    cpu_percent: float | None
    sample_rate: int | None
    output_size_bytes: int | None
    cold_start: bool
    success: bool
    error_message: str | None
    created_at: datetime


class BenchmarkRequest(BaseModel):
    sample_name: str = Field(default="default", max_length=80)
    text: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="en", max_length=10)
    cold_start: bool = False