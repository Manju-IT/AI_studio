from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from inference.contracts.base import TTSEngine
from inference.contracts.types import (
    AudioResult,
    Capability,
    ModelManifest,
    TTSRequest,
    VoiceDescriptor,
)


class KokoroAdapter(TTSEngine):
    """Real Kokoro-82M adapter using pykokoro (ONNX Runtime, CPU).

    pykokoro is a supported CPU inference path for Kokoro-82M. See:
    https://pypi.org/project/pykokoro/  — `pip install "pykokoro[cpu]"`.
    """

    def __init__(self, manifest: ModelManifest) -> None:
        self._manifest = manifest
        self._pipe: Any | None = None
        self._loaded = False

    @property
    def manifest(self) -> ModelManifest:
        return self._manifest

    def load(self) -> None:
        if self._loaded:
            return
        from pykokoro import KokoroPipeline, PipelineConfig

        model_path = Path(self._manifest.model_path)
        model_path.mkdir(parents=True, exist_ok=True)

        # pykokoro downloads or resolves the ONNX model from HuggingFace/GitHub.
        # We pin the voice and quantisation from the manifest.
        config = PipelineConfig(
            voice=self._manifest.extra.get("default_voice", "af_heart"),
            model_quality=self._manifest.extra.get("quality", "q8"),
            model_dir=str(model_path),
            retain_segment_audio=False,
        )
        self._pipe = KokoroPipeline(config)
        self._loaded = True

    def unload(self) -> None:
        if self._pipe is not None:
            try:
                self._pipe.close()
            finally:
                self._pipe = None
        self._loaded = False

    def is_loaded(self) -> bool:
        return self._loaded

    def capabilities(self) -> frozenset[Capability]:
        return self._manifest.capabilities

    def supported_languages(self) -> tuple[str, ...]:
        return self._manifest.languages

    def available_voices(self) -> list[VoiceDescriptor]:
        if not self._loaded:
            raise RuntimeError("Model is not loaded.")
        # pykokoro exposes a voice list; we filter to the manifest languages.
        raw = self._pipe.list_voices() if hasattr(self._pipe, "list_voices") else []
        voices: list[VoiceDescriptor] = []
        for item in raw:
            lang = str(item.get("language", "en")).lower()
            if not self._manifest.supports_language(lang):
                continue
            voices.append(
                VoiceDescriptor(
                    id=str(item["id"]),
                    name=str(item.get("name", item["id"])),
                    language=lang,
                    gender=item.get("gender"),
                    description=item.get("description"),
                )
            )
        if not voices:
            # Fallback: the pinned default voice is guaranteed to exist.
            default = self._manifest.extra.get("default_voice", "af_heart")
            voices.append(
                VoiceDescriptor(id=default, name=default, language="en", gender="female")
            )
        return voices

    def generate(self, request: TTSRequest) -> AudioResult:
        if not self._loaded or self._pipe is None:
            raise RuntimeError("Kokoro model is not loaded.")

        if not self._manifest.supports_language(request.language):
            raise ValueError(f"Kokoro does not support language '{request.language}'.")

        voice = request.voice_id or self._manifest.extra.get("default_voice", "af_heart")
        started = time.perf_counter()

        result = self._pipe.run(
            request.text,
            voice=voice,
            speed=float(request.settings.get("speed", 1.0)),
        )
        audio: np.ndarray = np.asarray(result.audio, dtype=np.float32)
        sample_rate = int(result.sample_rate)

        output = request.output_path or (
            Path(self._manifest.model_path) / ".." / ".." / "generated" / f"kokoro_{time.time_ns()}.wav"
        ).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)

        # Atomic write: temporary file then rename.
        tmp = output.with_suffix(".tmp.wav")
        sf.write(str(tmp), audio, sample_rate, subtype="PCM_16")
        tmp.replace(output)

        duration = len(audio) / sample_rate
        _ = time.perf_counter() - started

        return AudioResult(
            audio_path=output,
            duration_seconds=duration,
            sample_rate=sample_rate,
            format="wav",
            metadata={
                "engine": "kokoro",
                "voice_id": voice,
                "model_id": self._manifest.id,
                "rtf": round((time.perf_counter() - started) / max(duration, 1e-6), 3),
            },
        )

    async def stream(self, request: TTSRequest) -> Any:
        # Kokoro pipeline does not expose a verified incremental stream in pykokoro's
        # stable API. We therefore do not advertise streaming for Kokoro and yield
        # the full result once, which preserves the async contract without lying
        # about capability. The manifest's `streaming` flag is False.
        yield self.generate(request)

    def clone_voice(
        self,
        reference_audio: Path,
        reference_text: str,
        voice_name: str,
        consent_metadata: dict,
    ) -> VoiceDescriptor:
        raise NotImplementedError("Kokoro does not support voice cloning.")

    def design_voice(
        self,
        description: str,
        language: str,
        preview_text: str,
    ) -> tuple[VoiceDescriptor, AudioResult]:
        raise NotImplementedError("Kokoro does not support voice design.")

    def health_check(self) -> bool:
        return self._loaded and self._pipe is not None