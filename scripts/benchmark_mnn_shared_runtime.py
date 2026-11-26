from __future__ import annotations

import argparse
import gc
import hashlib
import json
import threading
import time
import traceback
from pathlib import Path

import numpy as np
import psutil
import soundfile as sf


ROOT = Path(__file__).resolve().parents[1]

MODEL_DIR = (
    ROOT
    / "storage"
    / "models"
    / "qwen3-tts-0.6b-base-mnn"
)

OUTPUT_DIR = ROOT / "storage" / "benchmarks"

GIB = 1024 ** 3

DEFAULT_TEXT = "Hello. Welcome to AI Voice Studio."


class MemoryMonitor:

    def __init__(self, interval=0.1):
        self.interval = interval
        self.process = psutil.Process()
        self.stop_event = threading.Event()
        self.thread = None

        self.peak_rss = 0
        self.minimum_available = float("inf")
        self.samples = 0

    def sample(self):
        rss = self.process.memory_info().rss
        available = psutil.virtual_memory().available

        self.peak_rss = max(self.peak_rss, rss)

        self.minimum_available = min(
            self.minimum_available,
            available,
        )

        self.samples += 1

    def _run(self):
        while not self.stop_event.is_set():
            self.sample()
            self.stop_event.wait(self.interval)

    def start(self):
        self.sample()

        self.thread = threading.Thread(
            target=self._run,
            daemon=True,
        )

        self.thread.start()

    def stop(self):
        self.stop_event.set()

        if self.thread is not None:
            self.thread.join()

        self.sample()

    def report(self):
        return {
            "peak_sampled_rss_gib": round(
                self.peak_rss / GIB, 4
            ),
            "minimum_available_gib": round(
                self.minimum_available / GIB, 4
            ),
            "samples": self.samples,
        }


class SharedPredictorRunner:

    def __init__(self, path, num_threads):
        import MNN

        self._MNN = MNN
        self.num_threads = num_threads

        self.inter = MNN.Interpreter(str(path))

        self.config = {
            "numThread": num_threads,
        }

        self.pooled = True
        self._pool = {}

        self.calls = 0
        self.pool_hits = 0
        self.pool_misses = 0

        print(
            "Creating shared predictor runtime...",
            flush=True,
        )

        self.runtime = self.inter.createRuntime(
            (self.config,)
        )

        if self.runtime is None:
            raise RuntimeError(
                "MNN createRuntime returned None."
            )

        print(
            "Shared runtime created:",
            type(self.runtime).__name__,
            flush=True,
        )

    def run(self, inputs, output_names):

        MNN = self._MNN

        self.calls += 1

        key = tuple(
            (name, tuple(inputs[name][0]))
            for name in sorted(inputs)
        )

        entry = self._pool.get(key)

        if entry is None:

            self.pool_misses += 1

            available = (
                psutil.virtual_memory().available / GIB
            )

            if available < 1.0:
                raise MemoryError(
                    "Available physical memory is below "
                    "the 1 GiB safety threshold."
                )

            print(
                f"Creating shared session "
                f"{self.pool_misses} | "
                f"Available RAM: {available:.2f} GiB",
                flush=True,
            )

            sess = self.inter.createSession(
                self.config,
                self.runtime,
            )

            if sess is None:
                raise RuntimeError(
                    "MNN failed to create shared session."
                )

            tensors = {}

            for name, (shape, _, _) in inputs.items():

                tensor = self.inter.getSessionInput(
                    sess,
                    name,
                )

                self.inter.resizeTensor(
                    tensor,
                    tuple(shape),
                )

                tensors[name] = tensor

            self.inter.resizeSession(sess)

            entry = (sess, tensors)

            self._pool[key] = entry

        else:
            self.pool_hits += 1

        sess, tensors = entry

        for name, (shape, htype, data) in inputs.items():

            if 0 in shape:
                continue

            host = MNN.Tensor(
                tuple(shape),
                htype,
                np.ascontiguousarray(data),
                MNN.Tensor_DimensionType_Caffe,
            )

            tensors[name].copyFrom(host)

        result = self.inter.runSession(sess)

        if isinstance(result, int) and result != 0:
            raise RuntimeError(
                f"MNN predictor execution failed: {result}"
            )

        outputs = []

        for name in output_names:

            output = self.inter.getSessionOutput(
                sess,
                name,
            )

            array = (
                np.asarray(output.getNumpyData())
                .reshape(tuple(output.getShape()))
                .copy()
            )

            if not np.isfinite(array).all():
                raise RuntimeError(
                    f"Nonfinite predictor output: {name}"
                )

            outputs.append(array)

        return outputs

    def close(self):

        self._pool.clear()

        self.runtime = None
        self.inter = None

        gc.collect()


def validate_assets(model_dir, voice_dir):

    required_model_files = [
        "talker_step.mnn",
        "cp_step.mnn",
        "vocoder.mnn",
        "tokenizer/vocab.json",
        "tokenizer/merges.txt",
        "weights/meta.json",
    ]

    required_voice_files = [
        "meta.json",
        "ref_code.i32.bin",
        "spk_emb.f32.bin",
    ]

    for name in required_model_files:

        path = model_dir / name

        if not path.is_file():
            raise FileNotFoundError(path)

    for name in required_voice_files:

        path = voice_dir / name

        if not path.is_file():
            raise FileNotFoundError(path)


def benchmark(args):

    from qwen3_tts_mnn import Qwen3TtsMnn

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    voice_dir = MODEL_DIR / args.voice

    validate_assets(MODEL_DIR, voice_dir)

    report_path = (
        OUTPUT_DIR
        / f"qwen_runtime_{args.mode}.json"
    )

    # Prevent a previous report from being mistaken
    # for the result of the current benchmark.
    report_path.unlink(missing_ok=True)

    monitor = MemoryMonitor()

    engine = None
    results = []

    print("=" * 65)
    print("QWEN MNN SHARED RUNTIME BENCHMARK")
    print("=" * 65)

    print("Mode:", args.mode)
    print("Threads:", args.threads)
    print("Voice:", args.voice)
    print("Seed:", args.seed)
    print("Repeats:", args.repeats)
    print("Text:", args.text)

    print(
        "Available RAM:",
        round(psutil.virtual_memory().available / GIB, 3),
        "GiB",
    )

    monitor.start()

    try:

        started = time.perf_counter()

        engine = Qwen3TtsMnn(
            str(MODEL_DIR),
            num_threads=args.threads,
            language="english",
            backend="pymnn",
        )

        load_seconds = time.perf_counter() - started

        print(
            f"\nModel loaded in {load_seconds:.3f}s",
            flush=True,
        )

        engine.load_voice(str(voice_dir))

        print("Voice loaded successfully", flush=True)

        if engine._cpu is not None:
            raise RuntimeError(
                "An unrolled predictor is present. "
                "This benchmark requires cp_step.mnn."
            )

        if engine._cp is None:
            raise RuntimeError(
                "Standard predictor is unavailable."
            )

        if args.mode == "shared":

            print(
                "\nReplacing standard predictor runner...",
                flush=True,
            )

            engine._cp.close()
            engine._cp = None

            gc.collect()

            engine._cp = SharedPredictorRunner(
                MODEL_DIR / "cp_step.mnn",
                args.threads,
            )

        else:
            print(
                "\nUsing original predictor session pool.",
                flush=True,
            )

        for index in range(args.repeats):

            print(
                f"\nGenerating run "
                f"{index + 1}/{args.repeats}...",
                flush=True,
            )

            started = time.perf_counter()

            codes = engine.synthesize_codes(
                args.text,
                temperature=0.7,
                top_k=50,
                top_p=0.9,
                repetition_penalty=1.1,
                seed=args.seed,
            )

            codec_seconds = (
                time.perf_counter() - started
            )

            codes = np.asarray(
                codes,
                dtype=np.int32,
            )

            if (
                codes.ndim != 2
                or codes.shape[1] != 16
                or codes.shape[0] == 0
            ):
                raise RuntimeError(
                    f"Invalid codec shape: {codes.shape}"
                )

            if np.any(codes < 0) or np.any(codes >= 2048):
                raise RuntimeError(
                    "Invalid codec token values."
                )

            vocoder_started = time.perf_counter()

            pcm = engine.codes_to_wav(codes)

            vocoder_seconds = (
                time.perf_counter() - vocoder_started
            )

            pcm = np.asarray(
                pcm,
                dtype=np.float32,
            ).reshape(-1)

            inference_seconds = (
                time.perf_counter() - started
            )

            if pcm.size == 0:
                raise RuntimeError("Empty audio output.")

            if not np.isfinite(pcm).all():
                raise RuntimeError(
                    "Audio contains NaN or infinity."
                )

            audio_seconds = len(pcm) / 24000

            if audio_seconds < 1.0:
                raise RuntimeError(
                    "Suspiciously short audio. "
                    "Benchmark output rejected."
                )

            audio_path = (
                OUTPUT_DIR
                / f"qwen_{args.mode}_{index + 1}.wav"
            )

            sf.write(
                str(audio_path),
                pcm,
                24000,
                subtype="PCM_16",
            )

            codec_hash = hashlib.sha256(
                codes.astype("<i4").tobytes()
            ).hexdigest()

            result = {
                "run": index + 1,
                "codec_frames": int(codes.shape[0]),
                "codec_sha256": codec_hash,
                "codec_seconds": round(
                    codec_seconds, 6
                ),
                "vocoder_seconds": round(
                    vocoder_seconds, 6
                ),
                "inference_seconds": round(
                    inference_seconds, 6
                ),
                "audio_seconds": round(
                    audio_seconds, 6
                ),
                "rtf": round(
                    inference_seconds / audio_seconds,
                    6,
                ),
                "pool_size": len(engine._cp._pool),
                "audio_path": str(audio_path),
                "process_rss_gib": round(
                    psutil.Process().memory_info().rss
                    / GIB,
                    4,
                ),
            }

            if args.mode == "shared":

                result.update({
                    "predictor_calls": engine._cp.calls,
                    "pool_hits": engine._cp.pool_hits,
                    "pool_misses": engine._cp.pool_misses,
                })

            results.append(result)

            print(
                json.dumps(result, indent=2),
                flush=True,
            )

        monitor.stop()

        report = {
            "mode": args.mode,
            "threads": args.threads,
            "voice": args.voice,
            "seed": args.seed,
            "text": args.text,
            "repeats": args.repeats,
            "language": "english",
            "model_load_seconds": round(
                load_seconds, 6
            ),
            "results": results,
            "memory_monitor": monitor.report(),
        }

        temp_path = report_path.with_suffix(".tmp")

        temp_path.write_text(
            json.dumps(report, indent=2),
            encoding="utf-8",
        )

        temp_path.replace(report_path)

        print("\n" + "=" * 65)
        print("BENCHMARK COMPLETED")
        print("=" * 65)

        print(
            json.dumps(
                report["memory_monitor"],
                indent=2,
            )
        )

        print("\nReport:", report_path)

    finally:

        monitor.stop()

        if engine is not None:

            print(
                "\nReleasing model resources...",
                flush=True,
            )

            engine.close()
            engine = None

        gc.collect()

        print("Cleanup completed.", flush=True)


def main():

    parser = argparse.ArgumentParser(
        description=(
            "Compare baseline and shared MNN "
            "predictor runtime performance."
        )
    )

    parser.add_argument(
        "--mode",
        required=True,
        choices=["baseline", "shared"],
    )

    parser.add_argument(
        "--threads",
        type=int,
        choices=range(1, 9),
        default=6,
    )

    parser.add_argument(
        "--voice",
        default="voice_priya",
    )

    parser.add_argument(
        "--repeats",
        type=int,
        choices=range(1, 11),
        default=1,
    )

    parser.add_argument(
        "--seed",
        type=int,
        default=42,
    )

    parser.add_argument(
        "--text",
        default=DEFAULT_TEXT,
    )

    args = parser.parse_args()

    try:
        benchmark(args)

    except KeyboardInterrupt:

        print("\nBenchmark interrupted.")

        raise SystemExit(130)

    except Exception:

        print("\nBENCHMARK FAILED", flush=True)

        traceback.print_exc()

        raise SystemExit(1)


if __name__ == "__main__":
    main()