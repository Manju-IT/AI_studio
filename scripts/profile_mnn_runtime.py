from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from collections import defaultdict

import numpy as np
import soundfile as sf

import qwen3_tts_mnn.engine as engine
from qwen3_tts_mnn import Qwen3TtsMnn


ROOT = Path(__file__).resolve().parents[1]

MODEL_DIR = ROOT / "storage" / "models" / "qwen3-tts-0.6b-base-mnn"

OUTPUT_DIR = ROOT / "storage" / "benchmarks"

METRICS = defaultdict(lambda: defaultdict(float))

RUNNER_NAMES = {}


def record(name, metric, value):
    METRICS[name][metric] += value


def profiled_run(self, inputs, output_names):

    MNN = self._MNN

    name = RUNNER_NAMES.get(id(self), "unknown")

    total_started = time.perf_counter()

    record(name, "calls", 1)

    # --------------------------------------------------
    # 1. Session creation and resizing
    # --------------------------------------------------

    started = time.perf_counter()

    if self.pooled:
        key = tuple((key, tuple(inputs[key][0])) for key in sorted(inputs))

        entry = self._pool.get(key)

        if entry is None:
            record(name, "pool_misses", 1)

            sess = self.inter.createSession({"numThread": self.num_threads})

            tensors = {}

            for key, (shape, _, _) in inputs.items():
                tensor = self.inter.getSessionInput(sess, key)

                self.inter.resizeTensor(tensor, tuple(shape))

                tensors[key] = tensor

            self.inter.resizeSession(sess)

            entry = (sess, tensors)

            self._pool[key] = entry

        else:
            record(name, "pool_hits", 1)

        sess, tensors = entry

    else:
        sess = self.sess
        tensors = {}

        for key, (shape, _, _) in inputs.items():
            tensor = self.inter.getSessionInput(sess, key)

            self.inter.resizeTensor(tensor, tuple(shape))

            tensors[key] = tensor

        self.inter.resizeSession(sess)

        record(name, "resize_calls", 1)

    record(name, "session_seconds", time.perf_counter() - started)

    # --------------------------------------------------
    # 2. Host tensor creation
    # 3. Input transfer
    # --------------------------------------------------

    for key, (shape, htype, data) in inputs.items():
        if 0 in shape:
            continue

        started = time.perf_counter()

        contiguous = np.ascontiguousarray(data)

        host = MNN.Tensor(
            tuple(shape),
            htype,
            contiguous,
            MNN.Tensor_DimensionType_Caffe,
        )

        record(name, "host_tensor_seconds", time.perf_counter() - started)

        started = time.perf_counter()

        tensors[key].copyFrom(host)

        record(name, "input_copy_seconds", time.perf_counter() - started)

        record(name, "input_bytes", contiguous.nbytes)

        if key == "past_kv":
            record(name, "kv_input_bytes", contiguous.nbytes)

    # --------------------------------------------------
    # 4. Actual MNN execution
    # --------------------------------------------------

    started = time.perf_counter()

    self.inter.runSession(sess)

    record(name, "execution_seconds", time.perf_counter() - started)

    # --------------------------------------------------
    # 5. Output extraction and copying
    # --------------------------------------------------

    outputs = []

    for key in output_names:
        started = time.perf_counter()

        tensor = self.inter.getSessionOutput(sess, key)

        output = (
            np.asarray(tensor.getNumpyData()).reshape(tuple(tensor.getShape())).copy()
        )

        outputs.append(output)

        record(name, "output_copy_seconds", time.perf_counter() - started)

        record(name, "output_bytes", output.nbytes)

        if key == "new_kv":
            record(name, "kv_output_bytes", output.nbytes)

    record(name, "total_seconds", time.perf_counter() - total_started)

    return outputs


def get_summary():

    summary = {}

    for name, values in METRICS.items():
        row = {}

        for key, value in values.items():
            if key.endswith("_bytes"):
                row[key.replace("_bytes", "_gib")] = round(value / (1024**3), 6)

            elif key.endswith("_seconds"):
                row[key] = round(value, 6)

            else:
                row[key] = int(value)

        total = values["total_seconds"]

        row["execution_percentage"] = round(
            100 * values["execution_seconds"] / max(total, 1e-9),
            2,
        )

        row["session_percentage"] = round(
            100 * values["session_seconds"] / max(total, 1e-9),
            2,
        )

        transfer_time = (
            values["host_tensor_seconds"]
            + values["input_copy_seconds"]
            + values["output_copy_seconds"]
        )

        row["transfer_percentage"] = round(
            100 * transfer_time / max(total, 1e-9),
            2,
        )

        summary[name] = row

    return summary


def main():

    parser = argparse.ArgumentParser()

    parser.add_argument("--threads", type=int, default=6)

    parser.add_argument("--voice", default="voice_priya")

    parser.add_argument("--repeats", type=int, default=3)

    parser.add_argument("--text", default="Hello. Welcome to AI Voice Studio.")

    args = parser.parse_args()

    if not 1 <= args.threads <= 8:
        parser.error("Threads must be between 1 and 8.")

    if args.repeats < 1:
        parser.error("Repeats must be positive.")

    if not args.text.strip():
        parser.error("Text cannot be empty.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    voice_path = (MODEL_DIR / args.voice).resolve()

    if not voice_path.is_relative_to(MODEL_DIR.resolve()):
        raise ValueError("Invalid voice directory.")

    original_run = engine._MnnRunner.run

    tts = None
    results = []

    try:
        print("=" * 65)
        print("QWEN MNN RUNTIME PROFILER")
        print("=" * 65)

        started = time.perf_counter()

        tts = Qwen3TtsMnn(
            str(MODEL_DIR),
            num_threads=args.threads,
            language="english",
            backend="pymnn",
        )

        tts.load_voice(str(voice_path))

        load_seconds = time.perf_counter() - started

        print(f"Model loading: {load_seconds:.3f}s")

        for attribute, name in [
            ("_talker", "talker"),
            ("_cp", "predictor"),
            ("_cpu", "unrolled_predictor"),
            ("_voc", "vocoder"),
        ]:
            runner = getattr(tts, attribute, None)

            if runner is not None:
                RUNNER_NAMES[id(runner)] = name

        engine._MnnRunner.run = profiled_run

        for run in range(1, args.repeats + 1):
            METRICS.clear()

            print(f"\nGenerating run {run}...")

            started = time.perf_counter()

            pcm = np.asarray(
                tts.synthesize(
                    args.text,
                    temperature=0.7,
                    top_k=50,
                    top_p=0.9,
                    repetition_penalty=1.1,
                    seed=42,
                ),
                dtype=np.float32,
            )

            elapsed = time.perf_counter() - started

            if pcm.ndim != 1 or pcm.size == 0 or not np.isfinite(pcm).all():
                raise RuntimeError("Invalid audio output.")

            duration = len(pcm) / 24000

            result = {
                "run": run,
                "inference_seconds": round(elapsed, 6),
                "audio_seconds": round(duration, 6),
                "rtf": round(elapsed / duration, 6),
                "runtime": get_summary(),
            }

            results.append(result)

            sf.write(
                OUTPUT_DIR / f"mnn_runtime_run_{run}.wav",
                pcm,
                24000,
                subtype="PCM_16",
            )

            print(json.dumps(result, indent=2))

        report = {
            "threads": args.threads,
            "voice": args.voice,
            "text": args.text,
            "model_load_seconds": load_seconds,
            "runs": results,
        }

        output = OUTPUT_DIR / "mnn_runtime_profile.json"

        output.write_text(
            json.dumps(report, indent=2),
            encoding="utf-8",
        )

        print("\nREPORT SAVED:", output)

    finally:
        engine._MnnRunner.run = original_run

        if tts is not None:
            tts.close()


if __name__ == "__main__":
    main()
