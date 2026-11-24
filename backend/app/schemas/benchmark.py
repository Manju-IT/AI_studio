from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class BenchmarkRequest(BaseModel):
    manifest_id: str = Field(min_length=2, max_length=160)
    samples: list[str] = Field(
        default_factory=lambda: ["short", "medium"],
        description="Subset of 'short', 'medium', 'long'. Unknown names are ignored.",
    )
    include_cold_start: bool = True


class BenchmarkOut(BaseModel):
    id: uuid.UUID
    installation_id: uuid.UUID
    manifest_id: str
    display_name: str
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


class BenchmarkSummary(BaseModel):
    manifest_id: str
    display_name: str
    runs: int
    best_rtf: float | None
    worst_rtf: float | None
    peak_ram_mb: int | None
    last_run_at: datetime | None