
"""Cached, in-memory CPU speaker diarization."""

import logging
import os
import time
from threading import Lock
from typing import Any

logger = logging.getLogger("uvicorn.error")

_pipeline: Any = None
_pipeline_key = None
_pipeline_lock = Lock()

MODEL_ID = "pyannote/speaker-diarization-3.1"
SAMPLE_RATE = 16000


def _get_int_env(
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default

    return max(minimum, min(maximum, value))


def _get_pipeline():
    global _pipeline, _pipeline_key

    import torch
    from pyannote.audio import Pipeline

    threads = _get_int_env(
        "DIARIZATION_CPU_THREADS", 4, 1, 8
    )

    segmentation_batch_size = _get_int_env(
        "DIARIZATION_SEGMENTATION_BATCH_SIZE",
        8, 1, 32
    )

    embedding_batch_size = _get_int_env(
        "DIARIZATION_EMBEDDING_BATCH_SIZE",
        8, 1, 32
    )

    key = (
        MODEL_ID,
        threads,
        segmentation_batch_size,
        embedding_batch_size,
    )

    started = time.perf_counter()

    if _pipeline is not None and _pipeline_key == key:
        logger.info(
            "DIARIZATION: cache_hit=True load=%.3fs",
            time.perf_counter() - started,
        )
        return _pipeline

    logger.info(
        "DIARIZATION: loading model=%s threads=%d",
        MODEL_ID,
        threads,
    )

    # PyTorch intra-operation thread configuration.
    torch.set_num_threads(threads)

    token = os.getenv("HF_TOKEN")

    kwargs = {}

    if token:
        kwargs["use_auth_token"] = token

    _pipeline = None
    _pipeline_key = None

    pipeline = Pipeline.from_pretrained(
        MODEL_ID,
        **kwargs,
    )

    if pipeline is None:
        raise RuntimeError(
            "Unable to load diarization pipeline. "
            "Check Hugging Face model access."
        )

    pipeline.to(torch.device("cpu"))

    # Configure batching where supported by the pipeline.
    if hasattr(pipeline, "segmentation_batch_size"):
        pipeline.segmentation_batch_size = (
            segmentation_batch_size
        )

    if hasattr(pipeline, "embedding_batch_size"):
        pipeline.embedding_batch_size = (
            embedding_batch_size
        )

    _pipeline = pipeline
    _pipeline_key = key

    logger.info(
        "DIARIZATION: cache_hit=False "
        "load=%.3fs segmentation_batch=%d "
        "embedding_batch=%d",
        time.perf_counter() - started,
        segmentation_batch_size,
        embedding_batch_size,
    )

    return _pipeline


def diarize(audio, speakers: int = 0) -> list[dict]:
    """
    Run speaker diarization directly on a
    16 kHz mono NumPy waveform.

    No subprocess or temporary audio files.
    """

    import numpy as np
    import torch

    started = time.perf_counter()

    if not 0 <= speakers <= 10:
        raise ValueError(
            "Speaker count must be between 0 and 10."
        )

    waveform = np.asarray(
        audio,
        dtype=np.float32,
    )

    if waveform.ndim != 1:
        raise ValueError(
            "Expected mono audio waveform."
        )

    if waveform.size == 0:
        return []

    if not np.isfinite(waveform).all():
        raise ValueError(
            "Audio contains invalid samples."
        )

    waveform = np.ascontiguousarray(waveform)

    duration = waveform.size / SAMPLE_RATE

    with _pipeline_lock:

        pipeline = _get_pipeline()

        # Convert NumPy waveform to PyTorch tensor.
        # Required shape: [channels, samples].
        tensor = torch.from_numpy(
            waveform
        ).unsqueeze(0)

        audio_input = {
            "waveform": tensor,
            "sample_rate": SAMPLE_RATE,
        }

        kwargs = {}

        if speakers > 0:
            kwargs["num_speakers"] = speakers

        logger.info(
            "DIARIZATION: audio=%.2fs speakers=%s",
            duration,
            speakers if speakers else "automatic",
        )

        inference_start = time.perf_counter()

        with torch.inference_mode():
            output = pipeline(
                audio_input,
                **kwargs,
            )

        inference_seconds = (
            time.perf_counter() - inference_start
        )

        # Support annotation-style output.
        annotation = getattr(
            output,
            "speaker_diarization",
            output,
        )

        turns = []

        for segment, _, speaker in annotation.itertracks(
            yield_label=True
        ):
            turns.append({
                "start": float(segment.start),
                "end": float(segment.end),
                "speaker": str(speaker),
            })

        turns.sort(
            key=lambda turn: (
                turn["start"],
                turn["end"],
            )
        )

    elapsed = time.perf_counter() - started

    logger.info(
        "DIARIZATION: completed "
        "turns=%d speakers=%d "
        "inference=%.3fs total=%.3fs RTF=%.4f",
        len(turns),
        len({t["speaker"] for t in turns}),
        inference_seconds,
        elapsed,
        elapsed / duration,
    )

    return turns


def attribute(words, turns):
    """
    Assign words using maximum temporal overlap.
    Preserve unassigned words as Unknown.
    """

    result = []
    names = {}

    for word in words:

        start = float(word["start"])
        end = float(word["end"])
        text = word["text"]

        best = max(
            turns,
            key=lambda turn: max(
                0.0,
                min(end, turn["end"])
                - max(start, turn["start"]),
            ),
            default=None,
        )

        if (
            best is not None
            and min(end, best["end"])
            > max(start, best["start"])
        ):
            label = names.setdefault(
                best["speaker"],
                f"Speaker {len(names) + 1}",
            )
        else:
            label = "Unknown"

        if (
            result
            and result[-1]["speaker"] == label
            and start - result[-1]["end"] <= 1.0
        ):
            result[-1]["end"] = max(
                result[-1]["end"],
                end,
            )
            result[-1]["text"] += text

        else:
            result.append({
                "start": start,
                "end": end,
                "text": text,
                "speaker": label,
            })

    for segment in result:
        segment["text"] = segment["text"].strip()

    return result
