"""Real TTS benchmark runner.

Measures, per (model, sample):
- Model load time (cold start only).
- Total generation time.
- Generated audio duration.
- Real-time factor (generation_time / audio_duration).
- Peak process RSS during generation (MB).
- Average CPU percent during generation.
- Output sample rate and file size.

The runner never fabricates results. If a model fails to load or generate,
the failure is recorded with `success=false` and the error message; the row is
still persisted so the UI shows honest failures alongside successes.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psutil

from app.core.config import get_settings
from app.core.logging import get_logger
from inference.contracts.types import Capability, TTSRequest
from inference.manager.loader import ModelLifecycleError, ModelManager

log = get_logger(__name__)

DEFAULT_SAMPLES: dict[str, dict[str, str]] = {
    "short": {
        "text": "The quick brown fox jumps over the lazy dog.",
        "language": "en",
    },
    "medium": {
        "text": (
            "Artificial intelligence has transformed how organizations approach "
            "content creation. Text-to-speech systems now produce natural-sounding "
            "audio in dozens of languages, enabling teams to localize material "
            "quickly and consistently. This paragraph is long enough to measure "
            "steady-state generation performance rather than startup overhead."
        ),
        "language": "en",
    },
    "long": {
        "text": (
            "When evaluating a text-to-speech engine for production use, several "
            "factors matter beyond raw speed. Voice quality, prosody, pronunciation "
            "accuracy, and consistency across chunks all influence the final user "
            "experience. On CPU-only hardware, the trade-off between model size and "
            "generation latency becomes especially pronounced. A 1.7 billion "
            "parameter model may produce richer audio, but if its real-time factor "
            "exceeds three, it becomes impractical for interactive use. Conversely, "
            "a lighter model may synthesize quickly while sacrificing naturalness. "
            "This is why we benchmark every registered model against identical "
            "inputs and record both objective metrics and subjective quality notes."
        ),
        "language": "en",
    },
}


@dataclass
class BenchmarkSample:
    name: str
    text: str
    language: str


@dataclass
class BenchmarkResult:
    sample_name: str
    text_length_chars: int
    generation_time_seconds: float
    audio_duration_seconds: float
    real_time_factor: float
    peak_ram_mb: int
    cpu_percent: float
    sample_rate: int
    output_size_bytes: int
    cold_start: bool
    success: bool
    error_message: str | None


def _measure_process(process: psutil.Process) -> tuple[int, float]:
    """Return (RSS MB, cpu percent averaged over a short window)."""
    try:
        rss = process.memory_info().rss // (1024 * 1024)
    except psutil.Error:
        rss = 0
    try:
        cpu = process.cpu_percent(interval=0.1)
    except psutil.Error:
        cpu = 0.0
    return rss, cpu


async def _sample_rss(process: psutil.Process, stop: asyncio.Event, out: list[int]) -> None:
    """Sample RSS every 100 ms until `stop` is set."""
    while not stop.is_set():
        try:
            out.append(process.memory_info().rss // (1024 * 1024))
        except psutil.Error:
            pass
        try:
            await asyncio.wait_for(stop.wait(), timeout=0.1)
        except asyncio.TimeoutError:
            pass


async def run_benchmarks(
    manager: ModelManager,
    manifest_id: str,
    samples: dict[str, dict[str, str]] | None = None,
    include_cold_start: bool = True,
) -> list[BenchmarkResult]:
    """Run a sequence of benchmarks for a single model.

    Loads the model once. Cold-start timing is captured on the first load;
    subsequent samples are warm-start. If `include_cold_start` is false the
    caller must already have the model loaded.
    """
    sample_map = samples or DEFAULT_SAMPLES
    results: list[BenchmarkResult] = []
    process = psutil.Process(os.getpid())

    # --- Cold start ---
    cold_load_seconds: float | None = None
    if include_cold_start:
        await manager.unload()
        started = time.perf_counter()
        try:
            await manager.ensure_loaded(manifest_id)
            cold_load_seconds = time.perf_counter() - started
        except ModelLifecycleError as exc:
            log.error("benchmark_cold_start_failed", manifest_id=manifest_id, error=str(exc))
            for name, spec in sample_map.items():
                results.append(
                    BenchmarkResult(
                        sample_name=f"{name}:cold",
                        text_length_chars=len(spec["text"]),
                        generation_time_seconds=cold_load_seconds or 0.0,
                        audio_duration_seconds=0.0,
                        real_time_factor=0.0,
                        peak_ram_mb=0,
                        cpu_percent=0.0,
                        sample_rate=0,
                        output_size_bytes=0,
                        cold_start=True,
                        success=False,
                        error_message=f"Model load failed: {exc}",
                    )
                )
            return results
    else:
        await manager.ensure_loaded(manifest_id)

    engine = await manager.ensure_loaded(manifest_id)
    if Capability.TEXT_TO_SPEECH not in engine.capabilities():
        raise RuntimeError(f"Model '{manifest_id}' does not support text_to_speech.")

    settings = get_settings()
    bench_dir = settings.temp_dir / "benchmarks" / manifest_id
    bench_dir.mkdir(parents=True, exist_ok=True)

    # --- Warm samples ---
    for name, spec in sample_map.items():
        out_path = bench_dir / f"{name}.wav"
        request = TTSRequest(
            text=spec["text"],
            language=spec["language"],
            voice_id=None,
            settings={},
            output_path=out_path,
        )

        baseline_rss, _ = _measure_process(process)
        rss_samples: list[int] = []
        stop = asyncio.Event()
        sampler = asyncio.create_task(_sample_rss(process, stop, rss_samples))

        started = time.perf_counter()
        try:
            result = await asyncio.to_thread(engine.generate, request)
            generation_seconds = time.perf_counter() - started
            stop.set()
            try:
                await sampler
            except asyncio.CancelledError:
                pass

            peak_rss = max(rss_samples) if rss_samples else baseline_rss
            cpu_avg = process.cpu_percent(interval=0.05)
            size = result.audio_path.stat().st_size if result.audio_path.exists() else 0

            results.append(
                BenchmarkResult(
                    sample_name=name,
                    text_length_chars=len(spec["text"]),
                    generation_time_seconds=generation_seconds,
                    audio_duration_seconds=result.duration_seconds,
                    real_time_factor=generation_seconds / max(result.duration_seconds, 1e-6),
                    peak_ram_mb=int(peak_rss),
                    cpu_percent=float(cpu_avg),
                    sample_rate=result.sample_rate,
                    output_size_bytes=size,
                    cold_start=False,
                    success=True,
                    error_message=None,
                )
            )
        except Exception as exc:
            stop.set()
            try:
                await sampler
            except asyncio.CancelledError:
                pass
            log.exception("benchmark_sample_failed", manifest_id=manifest_id, sample=name)
            results.append(
                BenchmarkResult(
                    sample_name=name,
                    text_length_chars=len(spec["text"]),
                    generation_time_seconds=time.perf_counter() - started,
                    audio_duration_seconds=0.0,
                    real_time_factor=0.0,
                    peak_ram_mb=max(rss_samples) if rss_samples else baseline_rss,
                    cpu_percent=0.0,
                    sample_rate=0,
                    output_size_bytes=0,
                    cold_start=False,
                    success=False,
                    error_message=str(exc)[:1000],
                )
            )
        finally:
            try:
                out_path.unlink(missing_ok=True)
            except OSError:
                pass

    if cold_load_seconds is not None:
        results.insert(
            0,
            BenchmarkResult(
                sample_name="cold_start_load",
                text_length_chars=0,
                generation_time_seconds=cold_load_seconds,
                audio_duration_seconds=0.0,
                real_time_factor=0.0,
                peak_ram_mb=int(psutil.Process(os.getpid()).memory_info().rss // (1024 * 1024)),
                cpu_percent=0.0,
                sample_rate=0,
                output_size_bytes=0,
                cold_start=True,
                success=True,
                error_message=None,
            ),
        )

    return results