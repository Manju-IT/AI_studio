"""
Benchmark Qwen3-TTS MNN CPU inference.

Run each thread configuration in a separate process
to avoid interference from previous MNN sessions.
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MODEL_DIR = ROOT / "storage" / "models" / "qwen3-tts-0.6b-base-mnn"

TEXT = "Hello. Welcome to AI Voice Studio."


def benchmark(threads, voice, repeats):

    import numpy as np
    import soundfile as sf

    from qwen3_tts_mnn import Qwen3TtsMnn

    output_dir = ROOT / "storage" / "benchmarks"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nCPU threads: {threads}")

    started = time.perf_counter()

    tts = Qwen3TtsMnn(
        str(MODEL_DIR),
        num_threads=threads,
    )

    tts.load_voice(str(MODEL_DIR / voice))

    load_seconds = time.perf_counter() - started

    results = []

    for run in range(1, repeats + 1):
        print(f"Generating sample {run}/{repeats}...")

        started = time.perf_counter()

        pcm = np.asarray(
            tts.synthesize(TEXT),
            dtype=np.float32,
        )

        elapsed = time.perf_counter() - started

        duration = len(pcm) / 24000

        if duration <= 0:
            raise RuntimeError("Empty audio output.")

        rtf = elapsed / duration

        path = output_dir / f"qwen_threads_{threads}_run_{run}.wav"

        sf.write(path, pcm, 24000)

        result = {
            "run": run,
            "inference_seconds": round(elapsed, 3),
            "audio_seconds": round(duration, 3),
            "rtf": round(rtf, 4),
        }

        results.append(result)

        print(json.dumps(result, indent=2))

    summary = {
        "threads": threads,
        "voice": voice,
        "load_seconds": round(load_seconds, 3),
        "median_rtf": float(np.median([r["rtf"] for r in results])),
        "runs": results,
    }

    path = output_dir / f"qwen_threads_{threads}.json"

    path.write_text(
        json.dumps(summary, indent=2),
        encoding="utf-8",
    )


def main():

    parser = argparse.ArgumentParser()

    parser.add_argument("--threads", type=int)

    parser.add_argument(
        "--voice",
        default="voices/demo",
    )

    parser.add_argument(
        "--repeats",
        type=int,
        default=2,
    )

    args = parser.parse_args()

    if args.repeats < 1:
        parser.error("--repeats must be positive")

    if args.threads is not None:
        if not 1 <= args.threads <= 8:
            parser.error("Threads must be between 1 and 8")

        benchmark(
            args.threads,
            args.voice,
            args.repeats,
        )

        return

    results = []

    for threads in (2, 4, 6, 8):
        subprocess.run(
            [
                sys.executable,
                str(Path(__file__).resolve()),
                "--threads",
                str(threads),
                "--voice",
                args.voice,
                "--repeats",
                str(args.repeats),
            ],
            check=True,
        )

        path = ROOT / "storage" / "benchmarks" / f"qwen_threads_{threads}.json"

        results.append(json.loads(path.read_text(encoding="utf-8")))

    results.sort(key=lambda item: item["median_rtf"])

    print("\n" + "=" * 60)
    print("BENCHMARK RESULTS")
    print("=" * 60)

    for result in results:
        print(
            f"Threads: {result['threads']} | "
            f"Median RTF: {result['median_rtf']:.3f} | "
            f"Load: {result['load_seconds']:.2f}s"
        )

    print("\nRecommended thread count:", results[0]["threads"])


if __name__ == "__main__":
    main()
