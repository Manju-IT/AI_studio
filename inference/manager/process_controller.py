"""Programmatic control over the separate inference worker process.

The worker is deliberately a separate OS process so that:
- CPU inference cannot block the FastAPI event loop.
- A model load that OOMs or deadlocks can be killed without taking down the API.
- The admin can restart inference without restarting the API.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


@dataclass
class WorkerHealth:
    alive: bool
    pid: int | None
    last_heartbeat_seconds: float | None


def _heartbeat_path() -> Path:
    return Path(get_settings().temp_dir) / "worker_heartbeat"


def read_heartbeat() -> float | None:
    path = _heartbeat_path()
    if not path.exists():
        return None
    try:
        return float(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


class WorkerProcessController:
    """Start, stop, and inspect the inference worker. Backend-agnostic."""

    def __init__(
        self,
        worker_module: str = "inference.worker",
        python_executable: str | None = None,
    ) -> None:
        self._module = worker_module
        self._python = python_executable or sys.executable
        self._process: subprocess.Popen[bytes] | None = None

    def start(self, extra_env: dict[str, str] | None = None) -> None:
        if self._process is not None and self._process.poll() is None:
            log.info("worker_already_running", pid=self._process.pid)
            return
        env = os.environ.copy()
        if extra_env:
            env.update(extra_env)
        log.info("worker_start", module=self._module)
        self._process = subprocess.Popen(
            [self._python, "-m", self._module],
            env=env,
            stdout=None,
            stderr=None,
        )

    def stop(self, timeout: float = 10.0) -> None:
        if self._process is None or self._process.poll() is not None:
            self._process = None
            return
        pid = self._process.pid
        log.info("worker_stop", pid=pid)
        try:
            self._process.send_signal(signal.SIGTERM)
            self._process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            log.warning("worker_force_kill", pid=pid)
            self._process.kill()
            self._process.wait(timeout=5)
        finally:
            self._process = None

    def restart(self) -> None:
        self.stop()
        time.sleep(0.5)
        self.start()

    def health(self, stale_after_seconds: float = 10.0) -> WorkerHealth:
        heartbeat = read_heartbeat()
        pid = self._process.pid if self._process and self._process.poll() is None else None
        alive = heartbeat is not None and (time.time() - heartbeat) < stale_after_seconds
        return WorkerHealth(
            alive=alive,
            pid=pid,
            last_heartbeat_seconds=heartbeat,
        )