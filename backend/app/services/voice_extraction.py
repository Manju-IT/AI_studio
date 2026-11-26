"""Offline extraction in a disposable child, with exclusive worker ownership."""
import os
import sys
import subprocess
import tempfile
from pathlib import Path
import numpy as np
import soundfile as sf
import psutil
from huggingface_hub import snapshot_download
from app.core.config import get_settings
from inference.voice_assets import profile_path, validate


def extract(voice_id, audio, transcript):
    settings = get_settings()
    target = profile_path(voice_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        validate(target)
        return
    if psutil.virtual_memory().available < 8 * 1024**3:
        raise ValueError('At least 8 GiB available RAM is required for extraction.')
    model = os.environ.get('QWEN_HF_MODEL_PATH') or snapshot_download('Qwen/Qwen3-TTS-12Hz-0.6B-Base', local_files_only=True)
    if not (Path(model)/'config.json').is_file(): raise ValueError('Cached HF model is missing')
    with tempfile.TemporaryDirectory(dir=target.parent) as tmp:
        root = Path(tmp)
        data, sr = sf.read(audio, dtype='float32', always_2d=True)
        data = data.mean(axis=1)
        if not 3 <= len(data)/sr <= 15 or not np.isfinite(data).all(): raise ValueError('Reference must be 3–15 seconds of valid audio')
        peak = float(np.max(np.abs(data)))
        if peak < 0.001: raise ValueError('Reference is silent')
        sf.write(root/'reference.wav', data * (0.9/peak), sr, subtype='PCM_16')
        out = root/'assets'
        env = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
        result = subprocess.run([sys.executable, '-c', 'from inference.local_job_child import extract_main; extract_main()', '--hf-model', str(model), '--ref-audio', str(root/'reference.wav'), '--ref-text', transcript, '--out', str(out), '--device', 'cpu'], env=env, capture_output=True, timeout=900)
        if result.returncode: raise ValueError(f'Extraction failed (exit {result.returncode}). Check model dependencies and available RAM.')
        validate(out, normalize=True)
        out.rename(target)
