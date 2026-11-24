from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

import psutil

from app.core.config import get_settings
from app.core.logging import get_logger
from inference.contracts.base import TTSEngine
from inference.contracts.types import ModelManifest
from inference.manager.factory import create_adapter
from inference.manager.registry import ManifestRegistry

log = get_logger(__name__)


class ModelLifecycleError(RuntimeError):
    pass


@dataclass
class LoadedModel:
    manifest: ModelManifest
    engine: TTSEngine
    loaded_at: float
    last_used_at: float


class ModelManager:
    """Owns a single loaded TTS engine at a time.

    The manager enforces:
    - Only one model loaded at once.
    - Unload-before-load, so a 1.7B model does not collide in RAM with a 0.6B one.
    - A RAM guard before loading, based on `max_ram_mb_for_inference`.
    - Idle unload after a configurable timeout to reclaim memory on a laptop.
    """

    def __init__(self, registry: ManifestRegistry) -> None:
        self._registry = registry
        self._current: LoadedModel | None = None
        self._lock = asyncio.Lock()
        self._idle_task: asyncio.Task[None] | None = None
        self._idle_timeout = float(
            getattr(get_settings(), "model_idle_unload_seconds", 600) or 600
        )

    async def start(self) -> None:
        self._registry.scan()
        self._idle_task = asyncio.create_task(self._idle_watch(), name="model-idle-watch")

    async def stop(self) -> None:
        if self._idle_task is not None:
            self._idle_task.cancel()
            try:
                await self._idle_task
            except asyncio.CancelledError:
                pass
            self._idle_task = None
        await self.unload()

    def active_manifest_id(self) -> str | None:
        return self._current.manifest.id if self._current else None

    async def ensure_loaded(self, manifest_id: str) -> TTSEngine:
        async with self._lock:
            if self._current and self._current.manifest.id == manifest_id:
                self._current.last_used_at = time.time()
                return self._current.engine

            if self._current is not None:
                log.info("model_unload_for_switch", current=self._current.manifest.id, next=manifest_id)
                await self._unload_locked()

            manifest = self._registry.get(manifest_id)
            if manifest is None:
                raise ModelLifecycleError(
                    f"Manifest '{manifest_id}' is not registered or is invalid."
                )

            self._check_memory(manifest)
            log.info("model_load_start", manifest_id=manifest.id, runtime=manifest.runtime.value)
            engine = create_adapter(manifest)

            started = time.perf_counter()
            try:
                await asyncio.to_thread(engine.load)
            except Exception as exc:
                log.error("model_load_failed", manifest_id=manifest.id, error=str(exc))
                raise ModelLifecycleError(f"Failed to load '{manifest.id}': {exc}") from exc
            load_seconds = time.perf_counter() - started

            if not engine.is_loaded():
                raise ModelLifecycleError(f"Adapter for '{manifest.id}' returned not loaded.")

            now = time.time()
            self._current = LoadedModel(
                manifest=manifest,
                engine=engine,
                loaded_at=now,
                last_used_at=now,
            )
            log.info(
                "model_load_ok",
                manifest_id=manifest.id,
                load_seconds=round(load_seconds, 2),
            )
            return engine

    async def unload(self) -> None:
        async with self._lock:
            await self._unload_locked()

    async def _unload_locked(self) -> None:
        if self._current is None:
            return
        manifest_id = self._current.manifest.id
        try:
            await asyncio.to_thread(self._current.engine.unload)
        except Exception as exc:
            log.warning("model_unload_error", manifest_id=manifest_id, error=str(exc))
        finally:
            self._current = None
            log.info("model_unloaded", manifest_id=manifest_id)

    def _check_memory(self, manifest: ModelManifest) -> None:
        if manifest.memory_estimate_mb is None:
            return
        settings = get_settings()
        available_mb = psutil.virtual_memory().available // (1024 * 1024)
        # 20% headroom above the estimate protects against runtime overhead.
        required_mb = int(manifest.memory_estimate_mb * 1.2)
        if available_mb < required_mb:
            raise ModelLifecycleError(
                f"Not enough RAM for '{manifest.id}': need ~{required_mb} MB, "
                f"{available_mb} MB available. Unload other models or close applications."
            )
        budget = settings.max_ram_mb_for_inference
        if required_mb > budget:
            raise ModelLifecycleError(
                f"'{manifest.id}' would use ~{required_mb} MB, above the configured "
                f"inference budget of {budget} MB. Raise MAX_RAM_MB_FOR_INFERENCE or choose a smaller model."
            )

    async def _idle_watch(self) -> None:
        try:
            while True:
                await asyncio.sleep(30)
                if self._current is None:
                    continue
                idle = time.time() - self._current.last_used_at
                if idle < self._idle_timeout:
                    continue
                log.info("model_idle_unload", manifest_id=self._current.manifest.id, idle=idle)
                await self.unload()
        except asyncio.CancelledError:
            return