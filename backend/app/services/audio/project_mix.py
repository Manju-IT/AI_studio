"""Bounded-memory mono WAV export with linear sample-rate conversion."""
from pathlib import Path
import numpy as np
import soundfile as sf


def render_project(sources: list[tuple[Path, int]], output: Path, rate: int = 24000):
    if not sources:
        raise ValueError("No sources")
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with sf.SoundFile(str(output), mode="w", samplerate=rate, channels=1, format="WAV", subtype="PCM_16") as dest:
            for index, (path, pause) in enumerate(sources):
                with sf.SoundFile(str(path)) as src:
                    # Read one segment at a time, capped at 20 minutes.
                    if len(src) > src.samplerate * 1200:
                        raise ValueError("Segment exceeds 20 minutes")
                    data = src.read(dtype="float32", always_2d=True).mean(axis=1)
                    if not len(data):
                        raise ValueError("Empty audio segment")
                    if src.samplerate != rate:
                        n = max(1, round(len(data)*rate/src.samplerate))
                        data = np.interp(np.arange(n)*src.samplerate/rate, np.arange(len(data)), data).astype(np.float32)
                    dest.write(data)
                if index < len(sources)-1 and pause:
                    dest.write(np.zeros(round(rate*pause/1000), dtype=np.float32))
    except Exception:
        output.unlink(missing_ok=True)
        raise


def render_aligned(sources, output: Path, rate: int = 24000):
    """Keep source starts when possible; shift overruns forward, never truncate."""
    import math
    if not sources:
        raise ValueError("No sources")
    limit = rate * 1800
    cursor = 0
    output.parent.mkdir(parents=True, exist_ok=True)
    def silence(dest, count):
        while count > 0:
            n = min(count, rate * 10)
            dest.write(np.zeros(n, dtype=np.float32))
            count -= n
    try:
        with sf.SoundFile(str(output), mode="w", samplerate=rate, channels=1, format="WAV", subtype="PCM_16") as dest:
            for path, start, end in sorted(sources, key=lambda s: s[1]):
                if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= 1800):
                    raise ValueError("Invalid source timestamps")
                target = max(cursor, round(start * rate))
                with sf.SoundFile(str(path)) as src:
                    if not 0 < len(src) <= src.samplerate * 1200:
                        raise ValueError("Invalid segment duration")
                    n = max(1, round(len(src) * rate / src.samplerate))
                    if target + n > limit:
                        raise ValueError("Aligned export exceeds 30 minutes")
                    data = src.read(dtype="float32", always_2d=True).mean(axis=1)
                    if not np.isfinite(data).all():
                        raise ValueError("Invalid audio samples")
                    if src.samplerate != rate:
                        data = np.interp(np.arange(n)*src.samplerate/rate, np.arange(len(data)), data).astype(np.float32)
                silence(dest, target - cursor)
                dest.write(data)
                cursor = target + len(data)
            silence(dest, max(0, round(max(s[2] for s in sources)*rate) - cursor))
    except Exception:
        output.unlink(missing_ok=True)
        raise
