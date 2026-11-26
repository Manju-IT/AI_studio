from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class ProjectFolderOut(ORMModel):
    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None


class ProjectOut(ORMModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_archived: bool
    created_at: datetime
    folders: list[ProjectFolderOut] = Field(default_factory=list)


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    is_archived: bool | None = None


class FolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: uuid.UUID | None = None

class ScriptSegment(BaseModel):
    id: uuid.UUID
    speaker: str = Field(default="", max_length=100)
    text: str = Field(max_length=50000)
    model_installation_id: uuid.UUID | None = None
    voice_id: uuid.UUID | None = None
    language: str = Field(default="en", max_length=10)
    pause_ms: int = Field(default=300, ge=0, le=10000)
    job_id: uuid.UUID | None = None
    source_text: str | None = Field(default=None, max_length=50000)
    source_start: float | None = Field(default=None, ge=0, le=1800, allow_inf_nan=False)
    source_end: float | None = Field(default=None, ge=0, le=1800, allow_inf_nan=False)

class ScriptSave(BaseModel):
    revision: int = Field(ge=0)
    segments: list[ScriptSegment] = Field(max_length=100)

class ScriptOut(ScriptSave):
    pass

class DubbingCreate(BaseModel):
    transcription_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    language: str = Field(pattern=r"^[a-z]{2}$")
