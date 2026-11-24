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