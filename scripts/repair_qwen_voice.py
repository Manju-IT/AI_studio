"""
Repair Qwen3-TTS MNN reference voice metadata.

Compatible with qwen3-tts-mnn 0.3.0.
Preserves reference audio codes and speaker embeddings.
"""

import argparse
import json
import shutil
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]

MODEL_DIR = ROOT / "storage" / "models" / "qwen3-tts-0.6b-base-mnn"


def repair_voice(voice_dir: Path):

    meta_path = voice_dir / "meta.json"
    code_path = voice_dir / "ref_code.i32.bin"
    embedding_path = voice_dir / "spk_emb.f32.bin"

    for path in (meta_path, code_path, embedding_path):
        if not path.is_file():
            raise FileNotFoundError(path)

    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    ids = np.asarray(meta["ref_ids"])

    print("Voice:", voice_dir.name)
    print("Original shape:", ids.shape)

    if ids.dtype.kind not in ("i", "u"):
        raise ValueError("Reference token IDs must be integers.")

    if ids.size <= 5:
        raise ValueError("Reference token sequence is too short.")

    if np.any(ids < 0):
        raise ValueError("Negative reference token ID.")

    # Reject multiple token sequences.
    if any(size != 1 for size in ids.shape[:-1]):
        raise ValueError(f"Unsupported token shape: {ids.shape}")

    # Canonical format: one batch containing one sequence.
    normalized = ids.reshape(1, -1)

    frames = meta["ref_frames"]

    if type(frames) is not int or frames <= 0:
        raise ValueError("Invalid reference frame count.")

    codes = np.fromfile(code_path, dtype=np.int32)

    expected_codes = frames * 16

    if codes.size != expected_codes:
        raise ValueError(f"Invalid codec size: {codes.size}; expected {expected_codes}")

    embedding = np.fromfile(
        embedding_path,
        dtype=np.float32,
    )

    if embedding.shape != (1024,):
        raise ValueError(f"Invalid embedding shape: {embedding.shape}")

    if not np.isfinite(embedding).all():
        raise ValueError("Speaker embedding contains invalid values.")

    if np.linalg.norm(embedding) == 0:
        raise ValueError("Empty speaker embedding.")

    print("Reference frames:", frames)
    print("Codec shape:", (frames, 16))
    print("Speaker embedding:", embedding.shape)
    print("Corrected shape:", normalized.shape)

    if ids.shape == normalized.shape:
        print("Metadata already compatible.")
        return

    backup = meta_path.with_suffix(".json.bak")

    if not backup.exists():
        shutil.copy2(meta_path, backup)

    meta["ref_ids"] = normalized.tolist()

    temporary = meta_path.with_suffix(".json.tmp")

    temporary.write_text(
        json.dumps(
            meta,
            indent=4,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    temporary.replace(meta_path)

    print("\nVOICE METADATA REPAIRED")
    print("Backup:", backup)
    print("Reference tokens preserved:", normalized.size)
    print("Binary assets unchanged.")


def main():

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--voice",
        default="voice_priya",
    )

    args = parser.parse_args()

    voice_dir = (MODEL_DIR / args.voice).resolve()

    if not voice_dir.is_relative_to(MODEL_DIR.resolve()):
        raise ValueError("Invalid voice directory.")

    repair_voice(voice_dir)


if __name__ == "__main__":
    main()
