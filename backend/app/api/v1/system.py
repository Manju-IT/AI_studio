
from __future__ import annotations

import shutil
import time
from pathlib import Path

import psutil
from fastapi import APIRouter, Depends

from app.api.deps import admin_user
from app.core.config import get_settings
from app.models.user import User
from app.schemas.system import (
    ResourceSnapshot,
    SystemStatusResponse,
    WorkerStatus,
)

from inference.manager.process_controller import WorkerProcessController


_controller = WorkerProcessController()
router = APIRouter()


@router.get("/resources", response_model=ResourceSnapshot)
async def resources(
    _: User = Depends(admin_user),
) -> ResourceSnapshot:
    settings = get_settings()

    vm = psutil.virtual_memory()
    disk = shutil.disk_usage(str(settings.storage_root))

    return ResourceSnapshot(
        cpu_percent=psutil.cpu_percent(interval=0.1),
        ram_total_mb=vm.total // (1024 * 1024),
        ram_used_mb=(vm.total - vm.available) // (1024 * 1024),
        ram_available_mb=vm.available // (1024 * 1024),
        disk_total_mb=disk.total // (1024 * 1024),
        disk_free_mb=disk.free // (1024 * 1024),
    )


@router.get("/status", response_model=SystemStatusResponse)
async def status(
    _: User = Depends(admin_user),
) -> SystemStatusResponse:
    settings = get_settings()

    vm = psutil.virtual_memory()
    disk = shutil.disk_usage(str(settings.storage_root))

    worker_pid = None
    worker_alive = False

    heartbeat_file = Path(settings.temp_dir) / "worker_heartbeat"
    last_heartbeat: float | None = None

    if heartbeat_file.exists():
        try:
            last_heartbeat = float(
                heartbeat_file.read_text().strip()
            )
        except (ValueError, OSError):
            last_heartbeat = None

    if last_heartbeat is not None:
        worker_alive = (time.time() - last_heartbeat) < 10.0

    return SystemStatusResponse(
        resources=ResourceSnapshot(
            cpu_percent=psutil.cpu_percent(interval=0.1),
            ram_total_mb=vm.total // (1024 * 1024),
            ram_used_mb=(vm.total - vm.available) // (1024 * 1024),
            ram_available_mb=vm.available // (1024 * 1024),
            disk_total_mb=disk.total // (1024 * 1024),
            disk_free_mb=disk.free // (1024 * 1024),
        ),
        worker=WorkerStatus(
            alive=worker_alive,
            pid=worker_pid,
            loaded_model=None,
            last_heartbeat_seconds=last_heartbeat,
        ),
        active_model_manifest_id=None,
    )


# --------------------------------------------------
# Worker Process Control (ADMIN ONLY)
# --------------------------------------------------

@router.post("/worker/start")
async def start_worker(
    _: User = Depends(admin_user),
) -> dict[str, str]:
    _controller.start()
    return {"status": "started"}


@router.post("/worker/stop")
async def stop_worker(
    _: User = Depends(admin_user),
) -> dict[str, str]:
    _controller.stop()
    return {"status": "stopped"}


@router.post("/worker/restart")
async def restart_worker(
    _: User = Depends(admin_user),
) -> dict[str, str]:
    _controller.restart()
    return {"status": "restarted"}
