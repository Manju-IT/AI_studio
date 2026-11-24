from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import soundfile as sf

_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?。！？…])(?:\s+|$)")
_CLAUSE_BOUNDARY = re.compile(r"(?<=[,;:，；：、])\s*")


def _split_sentences(text: str) -> list[str]:
    parts = _SENTENCE_BOUNDARY.split(text.strip())
    return [p.strip() for p in parts if p and p.strip()]


def _split_long_sentence(sentence: str, max_chars: int) -> list[str]:
    """Break a single over-long sentence into clause-sized pieces."""
    if len(sentence) <= max_chars:
        return [sentence]

    pieces: list[str] = []
    for clause in _CLAUSE_BOUNDARY.split(sentence):
        clause = clause.strip()
        if not clause:
            continue
        if len(clause) <= max_chars:
            pieces.append(clause)
            continue
        # Last resort: hard-wrap on whitespace near max_chars.
        words = clause.split()
        buf: list[str] = []
        length = 0
        for word in words:
            if length + len(word) + 1 > max_chars and buf:
                pieces.append(" ".join(buf))
                buf = [word]
                length = len(word)
            else:
                buf.append(word)
                length += len(word) + 1
        if buf:
            pieces.append(" ".join(buf))
    return pieces


def chunk_text(
    text: str,
    target_chars: int = 350,
    max_chars: int = 600,
) -> list[str]:
    """Split text into sentence-aware chunks suitable for TTS.

    Guarantees:
    - No empty chunks.
    - No chunk longer than `max_chars`.
    - Chunks are ordered and concatenating them reproduces the input text
      modulo whitespace.
    """
    if not text or not text.strip():
        return []

    sentences = _split_sentences(text)
    if not sentences:
        return [text.strip()]

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    def flush() -> None:
        nonlocal current, current_len
        if current:
            chunks.append(" ".join(current))
            current = []
            current_len = 0

    for sentence in sentences:
        if len(sentence) > max_chars:
            flush()
            chunks.extend(_split_long_sentence(sentence, max_chars))
            continue

        addition = len(sentence) + (1 if current else 0)
        if current and current_len + addition > target_chars:
            flush()

        current.append(sentence)
        current_len += addition

    flush()
    return chunks


def merge_wav_files(
    sources: list[Path],
    output: Path,
    pause_ms: int = 0,
    target_sample_rate: int | None = None,
) -> float:
    """Concatenate WAV files into a single WAV without ffmpeg.

    Returns the resulting duration in seconds.

    Raises:
        ValueError: if a source's sample rate differs from the first source
            and no `target_sample_rate` was provided.
    """
    if not sources:
        raise ValueError("At least one source file is required.")

    output.parent.mkdir(parents=True, exist_ok=True)

    buffers: list[np.ndarray] = []
    sample_rate: int | None = target_sample_rate

    for src in sources:
        with sf.SoundFile(str(src)) as fh:
            sr = target_sample_rate or fh.samplerate
            if sample_rate is None:
                sample_rate = sr
            if sr != sample_rate:
                raise ValueError(
                    f"Sample rate mismatch in {src.name}: {sr} vs {sample_rate}. "
                    "Provide target_sample_rate or resample first."
                )
            data = fh.read(dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            buffers.append(data)
            if pause_ms > 0:
                pad = np.zeros(int(sample_rate * pause_ms / 1000), dtype=np.float32)
                buffers.append(pad)

    if sample_rate is None:
        raise ValueError("Could not determine sample rate.")

    merged = np.concatenate(buffers) if buffers else np.zeros(0, dtype=np.float32)

    tmp = output.with_suffix(output.suffix + ".tmp")
    sf.write(str(tmp), merged, sample_rate, subtype="PCM_16")
    tmp.replace(output)

    return len(merged) / sample_rate