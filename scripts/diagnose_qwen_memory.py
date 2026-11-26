from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from collections import Counter

import numpy as np
import psutil
import soundfile as sf

from qwen3_tts_mnn import Qwen3TtsMnn
import qwen3_tts_mnn.engine as engine


ROOT = Path(__file__).resolve().parents[1]

MODEL_DIR = (
    ROOT
    / "storage"
    / "models"
    / "qwen3-tts-0.6b-base-mnn"
)

OUTPUT_DIR = ROOT / "storage" / "benchmarks"

PROCESS = psutil.Process()

GIB = 1024 ** 3

MAX_POOL_SESSIONS = 16


def memory_snapshot():
    process_memory = PROCESS.memory_info()
    system_memory = psutil.virtual_memory()
    swap_memory = psutil.swap_memory()

    return {
        "process_rss_gb": round(
            process_memory.rss / GIB, 3
        ),
        "system_available_gb": round(
            system_memory.available / GIB, 3
        ),
        "system_memory_percent": system_memory.percent,
        "swap_used_gb": round(
            swap_memory.used / GIB, 3
        ),
    }


def print_memory(label):
    print(
        f"\nMEMORY [{label}]:",
        json.dumps(memory_snapshot()),
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--threads",
        type=int,
        default=4,
    )

    parser.add_argument(
        "--voice",
        default="voice_priya",
    )

    parser.add_argument(
        "--text",
        default="Hello. Welcome to AI Voice Studio.",
    )

    args = parser.parse_args()

    if not 1 <= args.threads <= 8:
        parser.error("Threads must be between 1 and 8.")

    if not args.text.strip():
        parser.error("Text cannot be empty.")

    voice_dir = (MODEL_DIR / args.voice).resolve()

    if not voice_dir.is_relative_to(
        MODEL_DIR.resolve()
    ):
        raise ValueError("Invalid voice directory.")

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    print("=" * 65)
    print("QWEN MNN MEMORY DIAGNOSTICS")
    print("=" * 65)

    print("Threads:", args.threads)
    print("Voice:", args.voice)

    print_memory("before_model_load")

    original_run = engine._MnnRunner.run

    tts = None
    predictor = None

    shape_counts = Counter()

    stats = {
        "calls": 0,
        "pool_hits": 0,
        "pool_misses": 0,
        "frames": 0,
        "max_pool_size": 0,
    }

    def monitored_run(
        runner,
        inputs,
        output_names,
    ):
        # Preserve the original runtime implementation.
        if runner is not predictor:
            return original_run(
                runner,
                inputs,
                output_names,
            )

        key = tuple(
            (name, tuple(inputs[name][0]))
            for name in sorted(inputs)
        )

        stats["calls"] += 1
        shape_counts[key] += 1

        is_new = key not in runner._pool

        if is_new:
            stats["pool_misses"] += 1

            if len(runner._pool) >= MAX_POOL_SESSIONS:
                raise RuntimeError(
                    "Unexpected predictor session-pool "
                    "growth. Generation stopped."
                )

            print(
                f"\nNEW PREDICTOR SESSION "
                f"{len(runner._pool) + 1}",
                flush=True,
            )

            print("Input shapes:", key, flush=True)

            print_memory("before_session_creation")

        else:
            stats["pool_hits"] += 1

        outputs = original_run(
            runner,
            inputs,
            output_names,
        )

        stats["max_pool_size"] = max(
            stats["max_pool_size"],
            len(runner._pool),
        )

        # Check the returned KV-cache shape.
        if "new_kv" in output_names:
            index = output_names.index("new_kv")

            kv = outputs[index]

            if kv.ndim != 5:
                raise RuntimeError(
                    f"Invalid KV dimensions: {kv.shape}"
                )

            expected_length = (
                inputs["past_kv"][0][3]
                + inputs["inputs_embeds"][0][1]
            )

            if kv.shape[3] != expected_length:
                raise RuntimeError(
                    "Unexpected KV-cache length. "
                    f"Expected {expected_length}, "
                    f"received {kv.shape[3]}."
                )

        return outputs

    def on_frame(index, frame):
        stats["frames"] += 1

        if stats["frames"] % 10 == 0:
            print(
                f"Frames: {stats['frames']} | "
                f"Pool: {len(predictor._pool)} | "
                f"Hits: {stats['pool_hits']} | "
                f"Misses: {stats['pool_misses']}",
                flush=True,
            )

            print_memory("generation")

    try:
        started = time.perf_counter()

        tts = Qwen3TtsMnn(
            str(MODEL_DIR),
            num_threads=args.threads,
            language="english",
            backend="pymnn",
        )

        tts.load_voice(str(voice_dir))

        print(
            "Model loaded in:",
            round(time.perf_counter() - started, 3),
            "seconds",
        )

        print_memory("after_model_load")

        predictor = getattr(tts, "_cp", None)

        if predictor is None:
            raise RuntimeError(
                "Sequential predictor is unavailable."
            )

        engine._MnnRunner.run = monitored_run

        started = time.perf_counter()

        codes = tts.synthesize_codes(
            args.text,
            temperature=0.7,
            top_k=50,
            top_p=0.9,
            repetition_penalty=1.1,
            seed=42,
            on_frame=on_frame,
        )

        codec_seconds = time.perf_counter() - started

        if (
            codes.ndim != 2
            or codes.shape[1] != 16
            or codes.shape[0] == 0
        ):
            raise RuntimeError(
                f"Invalid codec output: {codes.shape}"
            )

        print("\nCodec shape:", codes.shape)

        print_memory("before_vocoder")

        started = time.perf_counter()

        pcm = np.asarray(
            tts.codes_to_wav(codes),
            dtype=np.float32,
        )

        vocoder_seconds = time.perf_counter() - started

        if (
            pcm.ndim != 1
            or pcm.size == 0
            or not np.isfinite(pcm).all()
        ):
            raise RuntimeError(
                "Invalid waveform output."
            )

        duration = pcm.size / 24000

        total_seconds = (
            codec_seconds + vocoder_seconds
        )

        result = {
            "threads": args.threads,
            "voice": args.voice,
            "audio_seconds": duration,
            "codec_seconds": codec_seconds,
            "vocoder_seconds": vocoder_seconds,
            "total_seconds": total_seconds,
            "rtf": total_seconds / duration,
            "predictor": stats,
            "unique_input_shapes": len(shape_counts),
            "memory": memory_snapshot(),
        }

        output = (
            OUTPUT_DIR
            / "qwen_memory_test.wav"
        )

        sf.write(
            output,
            pcm,
            24000,
            subtype="PCM_16",
        )

        print("\n" + "=" * 65)
        print("DIAGNOSTIC RESULTS")
        print("=" * 65)

        print(json.dumps(result, indent=2))

        print("\nAudio:", output)

        print(
            "Listen to the entire audio before "
            "accepting this test as successful."
        )

    finally:
        engine._MnnRunner.run = original_run

        print_memory("before_cleanup")

        if tts is not None:
            tts.close()

        print_memory("after_cleanup")


if __name__ == "__main__":
    main()