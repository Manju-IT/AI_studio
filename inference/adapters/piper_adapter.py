
from __future__ import annotations

import time
import wave
from pathlib import Path
from typing import Any

import soundfile as sf

from inference.contracts.base import TTSEngine
from inference.contracts.types import (
    AudioResult,
    Capability,
    ModelManifest,
    TTSRequest,
    VoiceDescriptor,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def resolve_model_path(model_path: str | Path) -> Path:
    path = Path(model_path).expanduser()

    if not path.is_absolute():
        path = PROJECT_ROOT / path

    return path.resolve()


class PiperAdapter(TTSEngine):
    """Official Piper TTS adapter using piper-tts."""

    def __init__(self, manifest: ModelManifest) -> None:
        self._manifest = manifest
        self._voice: Any | None = None
        self._loaded = False

    @property
    def manifest(self) -> ModelManifest:
        return self._manifest

    def load(self) -> None:
        if self._loaded:
            return

        from piper import PiperVoice

        model_path = Path(self._manifest.model_path)

        onnx = model_path / self._manifest.extra["onnx_file"]
        config = model_path / f"{self._manifest.extra['onnx_file']}.json"

        if not onnx.exists():
            raise FileNotFoundError(f"Piper ONNX model not found: {onnx}")

        if not config.exists():
            raise FileNotFoundError(f"Piper config not found: {config}")

        self._voice = PiperVoice.load(
            str(onnx),
            config_path=str(config),
        )

        self._loaded = True

    def unload(self) -> None:
        self._voice = None
        self._loaded = False

    def is_loaded(self) -> bool:
        return self._loaded

    def capabilities(self) -> frozenset[Capability]:
        return self._manifest.capabilities

    def supported_languages(self) -> tuple[str, ...]:
        return self._manifest.languages

    def available_voices(self) -> list[VoiceDescriptor]:
        if not self._loaded:
            raise RuntimeError("Piper model is not loaded.")

        speakers = self._manifest.extra.get("speakers", ["default"])

        return [
            VoiceDescriptor(
                id=str(speaker),
                name=str(speaker),
                language=self._manifest.languages[0],
            )
            for speaker in speakers
        ]

    def generate(self, request: TTSRequest) -> AudioResult:
        if not self._loaded or self._voice is None:
            raise RuntimeError("Piper model is not loaded.")

        if not self._manifest.supports_language(request.language):
            raise ValueError(
                f"Piper model does not support language '{request.language}'."
            )

        if not request.text.strip():
            raise ValueError("Input text cannot be empty.")

        output = request.output_path or (
            Path(self._manifest.model_path)
            / ".."
            / ".."
            / "generated"
            / f"piper_{time.time_ns()}.wav"
        ).resolve()

        output.parent.mkdir(parents=True, exist_ok=True)

        tmp = output.with_name(output.stem + ".tmp.wav")

        started = time.perf_counter()

        from piper.config import SynthesisConfig

        speaker_id = int(request.settings.get("speaker_id", 0))

        length_scale = float(
            request.settings.get("length_scale", 1.0)
        )

        noise_scale = float(
            request.settings.get("noise_scale", 0.667)
        )

        noise_w_scale = float(
            request.settings.get("noise_w", 0.8)
        )

        volume = float(
            request.settings.get("volume", 1.0)
        )

        syn_config = SynthesisConfig(
            speaker_id=speaker_id,
            length_scale=length_scale,
            noise_scale=noise_scale,
            noise_w_scale=noise_w_scale,
            volume=volume,
        )

        try:
            with wave.open(str(tmp), "wb") as wav_file:
                self._voice.synthesize_wav(
                    request.text,
                    wav_file,
                    syn_config=syn_config,
                    set_wav_format=True,
                )

            if not tmp.exists() or tmp.stat().st_size == 0:
                raise RuntimeError("Piper generated an empty audio file.")

            tmp.replace(output)

        except Exception:
            if tmp.exists():
                tmp.unlink()
            raise

        with sf.SoundFile(str(output)) as audio:
            sample_rate = audio.samplerate
            frames = len(audio)

        duration = frames / sample_rate

        elapsed = time.perf_counter() - started

        return AudioResult(
            audio_path=output,
            duration_seconds=duration,
            sample_rate=sample_rate,
            format="wav",
            metadata={
                "engine": "piper",
                "model_id": self._manifest.id,
                "speaker_id": speaker_id,
                "length_scale": length_scale,
                "rtf": round(
                    elapsed / max(duration, 1e-6),
                    3,
                ),
            },
        )

    async def stream(self, request: TTSRequest) -> Any:
        # Piper adapter currently provides chunk-independent generation.
        yield self.generate(request)

    def clone_voice(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> VoiceDescriptor:
        raise NotImplementedError(
            "Piper does not support voice cloning."
        )

    def design_voice(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> tuple[VoiceDescriptor, AudioResult]:
        raise NotImplementedError(
            "Piper does not support voice design."
        )

    def health_check(self) -> bool:
        return self._loaded and self._voice is not None
