
from pathlib import Path
import wave

from piper import PiperVoice

MODEL = Path(
    "storage/models/piper/en_US-amy-medium/en_US-amy-medium.onnx"
)

CONFIG = Path(
    "storage/models/piper/en_US-amy-medium/en_US-amy-medium.onnx.json"
)

OUTPUT = Path("piper_test.wav")

print("Loading Piper...")

voice = PiperVoice.load(
    str(MODEL),
    config_path=str(CONFIG),
)

print("Generating audio...")

with wave.open(str(OUTPUT), "wb") as wav_file:
    voice.synthesize_wav(
        "Hello! This is a test of my local AI voice generation system.",
        wav_file,
    )

print("Audio generated successfully!")
print("Output:", OUTPUT.resolve())
