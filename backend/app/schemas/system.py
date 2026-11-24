from __future__ import annotations

from pydantic import BaseModel, Field


class ResourceSnapshot(BaseModel):
    cpu_percent: float = Field(ge=0, le=100)
    ram_total_mb: int
    ram_used_mb: int
    ram_available_mb: int
    disk_total_mb: int
    disk_free_mb: int


class WorkerStatus(BaseModel):
    alive: bool
    pid: int | None = None
    loaded_model: str | None = None
    last_heartbeat_seconds: float | None = None


class SystemStatusResponse(BaseModel):
    resources: ResourceSnapshot
    worker: WorkerStatus
    active_model_manifest_id: str | None = None