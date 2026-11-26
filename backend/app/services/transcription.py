
"""Optimized local CPU speech recognition."""

import logging
import os
import time

from pathlib import Path
from threading import Lock

from app.core.config import get_settings

logger = logging.getLogger("uvicorn.error")

_lock = Lock()

_engine = None
_key = None

SAMPLE_RATE = 16000
MAX_DURATION = 1800
MAX_SEGMENTS = 20000


def _get_threads(default: int) -> int:
    try:
        threads = int(
            os.getenv(
                "ASR_CPU_THREADS",
                str(default),
            )
        )
    except ValueError:
        threads = default

    return max(1, min(8, threads))


def _get_engine(model: str):
    global _engine, _key

    from faster_whisper import WhisperModel

    settings = get_settings()

    threads = _get_threads(
        min(4, settings.cpu_threads)
    )

    cache_dir = str(
        settings.model_cache_dir / "whisper"
    )

    key = (
        model,
        threads,
        cache_dir,
    )

    started = time.perf_counter()

    hit = (
        _engine is not None
        and _key == key
    )

    if not hit:

        _engine = None
        _key = None

        _engine = WhisperModel(
            model,
            device="cpu",
            compute_type="int8",
            cpu_threads=threads,
            num_workers=1,
            download_root=cache_dir,
            local_files_only=True,
        )

        _key = key

    load_seconds = (
        time.perf_counter() - started
    )

    logger.info(
        "ASR: model=%s threads=%d "
        "cache_hit=%s load=%.3fs",
        model,
        threads,
        hit,
        load_seconds,
    )

    return (
        _engine,
        hit,
        threads,
        load_seconds,
    )


def _inspect_audio(source: Path):
    import av

    with av.open(str(source)) as container:

        stream = next(
            iter(container.streams.audio),
            None,
        )

        if stream is None:
            raise ValueError(
                "No audio stream found."
            )

        if (
            stream.duration is not None
            and stream.time_base is not None
        ):
            duration = float(
                stream.duration * stream.time_base
            )

        elif container.duration:
            duration = (
                container.duration / 1_000_000
            )

        else:
            duration = None

        if (
            duration is not None
            and not 0 < duration <= MAX_DURATION
        ):
            raise ValueError(
                "Audio must be at most 30 minutes."
            )


def transcribe(
    source: Path,
    model: str,
    language: str,
    diarization: bool = False,
    speakers: int = 0,
) -> dict:

    import numpy as np
    from faster_whisper.audio import decode_audio

    started = time.perf_counter()

    with _lock:

        queue_seconds = (
            time.perf_counter() - started
        )

        # -----------------------------
        # 1. Audio inspection
        # -----------------------------

        _inspect_audio(source)

        # -----------------------------
        # 2. Decode audio once
        # -----------------------------

        decode_start = time.perf_counter()

        audio = decode_audio(
            str(source),
            sampling_rate=SAMPLE_RATE,
        )

        audio = np.ascontiguousarray(
            audio,
            dtype=np.float32,
        )

        duration = (
            len(audio) / SAMPLE_RATE
        )

        if not 0 < duration <= MAX_DURATION:
            raise ValueError(
                "Invalid decoded audio duration."
            )

        decode_seconds = (
            time.perf_counter() - decode_start
        )

        logger.info(
            "ASR: decoded audio=%.2fs decode=%.3fs",
            duration,
            decode_seconds,
        )

        # -----------------------------
        # 3. Load or reuse Whisper
        # -----------------------------

        (
            engine,
            cache_hit,
            threads,
            load_seconds,
        ) = _get_engine(model)

        # -----------------------------
        # 4. Speech recognition
        # -----------------------------

        asr_start = time.perf_counter()

        segments, info = engine.transcribe(
            audio,

            language=(
                None
                if language == "auto"
                else language
            ),

            task="transcribe",

            beam_size=1,
            best_of=1,
            temperature=0.0,

            vad_filter=True,

            word_timestamps=diarization,

            condition_on_previous_text=False,

            repetition_penalty=1.1,

            no_repeat_ngram_size=4,

            hallucination_silence_threshold=(
                2.0 if diarization else None
            ),
        )

        result = []
        words = []

        for segment in segments:

            if len(result) >= MAX_SEGMENTS:
                raise ValueError(
                    "Too many transcription segments."
                )

            result.append({
                "start": float(segment.start),
                "end": float(segment.end),
                "text": segment.text.strip(),
            })

            if diarization:

                for word in segment.words or []:

                    if (
                        word.start is None
                        or word.end is None
                    ):
                        continue

                    words.append({
                        "start": float(word.start),
                        "end": float(word.end),
                        "text": word.word,
                    })

        asr_seconds = (
            time.perf_counter() - asr_start
        )

        logger.info(
            "ASR: recognition completed "
            "segments=%d words=%d time=%.3fs",
            len(result),
            len(words),
            asr_seconds,
        )

        # -----------------------------
        # 5. Speaker diarization
        # -----------------------------

        diarization_seconds = 0.0
        alignment_seconds = 0.0

        if diarization and result:

            from app.services.diarization import (
                diarize,
                attribute,
            )

            if not words:
                raise RuntimeError(
                    "Word timestamps unavailable."
                )

            diarization_start = (
                time.perf_counter()
            )

            turns = diarize(
                audio,
                speakers,
            )

            diarization_seconds = (
                time.perf_counter()
                - diarization_start
            )

            # -------------------------
            # 6. Speaker attribution
            # -------------------------

            alignment_start = (
                time.perf_counter()
            )

            result = attribute(
                words,
                turns,
            )

            alignment_seconds = (
                time.perf_counter()
                - alignment_start
            )

        # -----------------------------
        # 7. Performance metrics
        # -----------------------------

        elapsed = (
            time.perf_counter() - started
        )

        inference_seconds = (
            asr_seconds
            + diarization_seconds
            + alignment_seconds
        )

        rtf = elapsed / duration

        performance = {
            "model_cache_hit": cache_hit,

            "cpu_threads": threads,

            "queue_seconds": round(
                queue_seconds, 3
            ),

            "audio_decode_seconds": round(
                decode_seconds, 3
            ),

            "model_load_seconds": round(
                load_seconds, 3
            ),

            "asr_seconds": round(
                asr_seconds, 3
            ),

            "diarization_seconds": round(
                diarization_seconds, 3
            ),

            "alignment_seconds": round(
                alignment_seconds, 3
            ),

            "inference_seconds": round(
                inference_seconds, 3
            ),

            "total_seconds": round(
                elapsed, 3
            ),

            "real_time_factor": round(
                rtf, 4
            ),

            "speed_multiplier": round(
                duration / max(elapsed, 0.001),
                3,
            ),
        }

        logger.info(
            "ASR PERFORMANCE: "
            "audio=%.2fs queue=%.3fs "
            "decode=%.3fs model_load=%.3fs "
            "recognition=%.3fs "
            "diarization=%.3fs "
            "alignment=%.3fs "
            "total=%.3fs RTF=%.4f",
            duration,
            queue_seconds,
            decode_seconds,
            load_seconds,
            asr_seconds,
            diarization_seconds,
            alignment_seconds,
            elapsed,
            rtf,
        )

        return {
            "segments": result,
            "language": info.language,
            "duration": duration,
            "performance": performance,
        }
