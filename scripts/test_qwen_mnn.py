
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from qwen3_tts_mnn import Qwen3TtsMnn


ROOT = Path(__file__).resolve().parents[1]

MODEL_DIR = (
    ROOT
    / "storage"
    / "models"
    / "qwen3-tts-0.6b-base-mnn"
)

OUTPUT = ROOT / "qwen_test.wav"

REQUIRED_FILES = [
    "tokenizer/vocab.json",
    "tokenizer/merges.txt",
    "talker_step.mnn",
    "cp_step.mnn",
    "vocoder.mnn",
    "weights/meta.json",
]

print("=" * 60)
print("QWEN3-TTS MNN CPU TEST")
print("=" * 60)

print("Model directory:", MODEL_DIR)

for name in REQUIRED_FILES:

    path = MODEL_DIR / name

    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError(
            f"Missing required model asset: {path}"
        )

    print(f"[OK] {name}")


print("\nSearching for voice profiles...")

voice_files = [
    "meta.json",
    "ref_code.i32.bin",
    "spk_emb.f32.bin",
]

voices = [
    directory
    for directory in MODEL_DIR.iterdir()
    if directory.is_dir()
    and all(
        (directory / name).is_file()
        for name in voice_files
    )
]

if not voices:
    raise RuntimeError(
        "No compatible voice profiles found. "
        "Install a pre-extracted MNN voice profile."
    )

for voice in voices:
    print("Available voice:", voice.name)

default_voice = MODEL_DIR / "voice_priya"

voice = (
    default_voice
    if default_voice in voices
    else voices[0]
)

print("\nLoading Qwen model...")

started = time.perf_counter()

tts = Qwen3TtsMnn(
    str(MODEL_DIR),
    num_threads=4,
)

load_time = time.perf_counter() - started

print(f"Model loaded in {load_time:.2f}s")

print("\nLoading voice:", voice.name)

tts.load_voice(str(voice))

print("Voice loaded successfully")

text = (
    "Hello. This is a test of the "
    "local Qwen text to speech model."
)

print("\nGenerating speech...")
print("Text:", text)

started = time.perf_counter()

pcm = tts.synthesize(text)

elapsed = time.perf_counter() - started

pcm = np.asarray(
    pcm,
    dtype=np.float32,
)

if pcm.size == 0:
    raise RuntimeError("Generated audio is empty")

if not np.isfinite(pcm).all():
    raise RuntimeError("Generated audio is invalid")

sample_rate = 24000

sf.write(
    str(OUTPUT),
    pcm,
    sample_rate,
    subtype="PCM_16",
)

duration = len(pcm) / sample_rate

print("\n" + "=" * 60)
print("GENERATION SUCCESSFUL")
print("=" * 60)

print("Output:", OUTPUT)
print(f"Audio duration: {duration:.2f}s")
print(f"Inference time: {elapsed:.2f}s")
print(f"Real-time factor: {elapsed / duration:.3f}")
