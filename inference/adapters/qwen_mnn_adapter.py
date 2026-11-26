from __future__ import annotations

import time
from app.core.config import get_settings
import logging
from threading import RLock

logger = logging.getLogger(__name__)
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


class QwenMnnAdapter(TTSEngine):
    """Real Qwen3-TTS 0.6B Base adapter via qwen3-tts-mnn (pure CPU, MNN).

    Verified package: https://pypi.org/project/qwen3-tts-mnn/
    The MNN assets (~1.9 GB) are NOT bundled with the PyPI package and must be
    prepared separately. Voice-cloning assets are extracted once with the
    `[extract]` extra and then used at runtime without torch.
    """

    def __init__(self, manifest: ModelManifest) -> None:
        self._manifest = manifest
        self._tts: Any | None = None
        self._loaded = False
        self._voice_path = None
        self._lock = RLock()

    @property
    def manifest(self) -> ModelManifest:
        return self._manifest

    def load(self) -> None:
        if self._loaded:
            return
        from qwen3_tts_mnn import Qwen3TtsMnn

        model_dir = Path(self._manifest.model_path)
        if not model_dir.exists():
            raise FileNotFoundError(f"Qwen MNN model directory not found: {model_dir}")   

        threads = int(self._manifest.extra.get("threads", 6))
        self._tts = Qwen3TtsMnn(str(model_dir), num_threads=threads, language="english", backend="pymnn")
        logger.info("Qwen threads=%s unrolled=%s", threads, self._tts._cpu is not None)

        voice_dir = self._manifest.extra.get("default_voice_dir")
        if voice_dir:
            vd = Path(voice_dir)
            if not vd.is_absolute():
                vd = model_dir / vd
            if vd.exists():
                self._tts.load_voice(str(vd))
                self._voice_path = vd.resolve()
        self._loaded = True

    def unload(self) -> None:
        with self._lock:
            if self._tts is not None:
                self._tts.close()
            self._tts = None
            self._voice_path = None
            self._loaded = False

    def is_loaded(self) -> bool:
        return self._loaded

    def capabilities(self) -> frozenset[Capability]:
        return self._manifest.capabilities

    def supported_languages(self) -> tuple[str, ...]:
        return self._manifest.languages

    def available_voices(self) -> list[VoiceDescriptor]:
        # Voice assets are directories under the model directory, each with meta.json.    
        model_dir = Path(self._manifest.model_path)
        voices: list[VoiceDescriptor] = []
        for child in sorted(model_dir.iterdir()):
            if child.is_dir() and all((child / f).is_file() for f in ("meta.json", "ref_code.i32.bin", "spk_emb.f32.bin")):
                voices.append(
                    VoiceDescriptor(
                        id=child.name,
                        name=child.name.replace("_", " ").title(),
                        language=self._manifest.languages[0],
                        is_cloned=True,
                    )
                )
        if not voices:
            default = self._manifest.extra.get("default_voice_dir")
            if default:
                voices.append(
                    VoiceDescriptor(
                        id=Path(default).name,
                        name=Path(default).name,
                        language=self._manifest.languages[0],
                    )
                )
        return voices

    def generate(self, request: TTSRequest) -> AudioResult:
        with self._lock:
            return self._generate(request)

    def _generate(self, request: TTSRequest) -> AudioResult:
        if not self._loaded or self._tts is None:
            raise RuntimeError("Qwen MNN model is not loaded.")

        if not self._manifest.supports_language(request.language):
            raise ValueError(
                f"Qwen3-TTS does not officially support language '{request.language}'. "  
                "Supported languages: " + ", ".join(self._manifest.languages)
            )

        from qwen3_tts_mnn.engine import LANG_IDS
        names = {"en": "english", "zh": "chinese", "ja": "japanese",
                 "ko": "korean", "de": "german", "fr": "french",
                 "ru": "russian", "pt": "portuguese", "es": "spanish", "it": "italian"}
        language = names.get(request.language, request.language)
        if language not in LANG_IDS:
            raise ValueError(f"Runtime does not support language: {language}")
        self._tts.lang_id = LANG_IDS[language]

        voice_dir = request.voice_id or self._manifest.extra.get("default_voice_dir")     
        if voice_dir:
            vd = Path(voice_dir)
            if not vd.is_absolute():
                vd = Path(self._manifest.model_path) / vd
            vd = vd.resolve()
            if not vd.is_relative_to(Path(self._manifest.model_path).resolve()) and not vd.is_relative_to((get_settings().storage_root / "private_voices").resolve()):
                raise ValueError("Voice directory must be inside the model directory")
            if vd != self._voice_path:
                self._tts.load_voice(str(vd))
                self._voice_path = vd
        else:
            raise ValueError("No Qwen voice configured")

        output = request.output_path or (
            Path(self._manifest.model_path) / ".." / ".." / "generated" / f"qwen_{time.time_ns()}.wav"
        ).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        tmp = output.with_suffix(".tmp.wav")

        started = time.perf_counter()
        settings = request.settings
        codes = self._tts.synthesize_codes(
            request.text,
            temperature=float(settings.get("temperature", 0.7)),
            top_k=int(settings.get("top_k", 50)),
            top_p=float(settings.get("top_p", 0.9)),
            repetition_penalty=float(settings.get("repetition_penalty", 1.1)),
            seed=settings.get("seed"),
        )
        codec_seconds = time.perf_counter() - started
        if codes.ndim != 2 or codes.shape[0] == 0 or codes.shape[1] != 16:
            raise RuntimeError("Qwen returned invalid codec frames")
        voc_started = time.perf_counter()
        pcm = np.asarray(self._tts.codes_to_wav(codes), dtype=np.float32)
        vocoder_seconds = time.perf_counter() - voc_started
        if pcm.ndim != 1 or not pcm.size or not np.isfinite(pcm).all():
            raise RuntimeError("Qwen returned invalid audio")
        try:
            sf.write(str(tmp), pcm, 24000, subtype="PCM_16")
            tmp.replace(output)
        finally:
            tmp.unlink(missing_ok=True)
        logger.warning("QWEN PERFORMANCE: language=%s frames=%d codec=%.3fs vocoder=%.3fs audio=%.3fs",
                       language, len(codes), codec_seconds, vocoder_seconds, len(pcm)/24000)

        duration = len(pcm) / 24000.0
        elapsed = time.perf_counter() - started

        return AudioResult(
            audio_path=output,
            duration_seconds=duration,
            sample_rate=24000,
            format="wav",
            metadata={
                "engine": "qwen_mnn",
                "model_id": self._manifest.id,
                "codec_seconds": codec_seconds,
                "vocoder_seconds": vocoder_seconds,
                "rtf": round(elapsed / max(duration, 1e-6), 3),
            },
        )

    async def stream(self, request: TTSRequest) -> Any:
        # The MNN package exposes an `on_frame` callback; a true async generator
        # requires buffering. We keep streaming capability gated on the manifest.
        yield self.generate(request)

    def clone_voice(
        self,
        reference_audio: Path,
        reference_text: str,
        voice_name: str,
        consent_metadata: dict,
    ) -> VoiceDescriptor:
        if Capability.VOICE_CLONING not in self._manifest.capabilities:
            raise NotImplementedError("This Qwen MNN manifest does not support cloning.") 
        # The extraction step requires the [extract] extra and the original HF model.     
        # It must be run by an admin, not at request time. We therefore register
        # the voice directory if it already exists.
        target = Path(self._manifest.model_path) / voice_name
        if not target.exists():
            raise FileNotFoundError(
                f"Cloned voice assets not found at {target}. "
                "Run `qwen3-tts-mnn-extract` on the server first. "
                "See docs/MODEL_SETUP.md."
            )
        return VoiceDescriptor(
            id=voice_name,
            name=voice_name,
            language=self._manifest.languages[0],
            is_cloned=True,
        )

    def design_voice(self, *args: Any, **kwargs: Any) -> tuple[VoiceDescriptor, AudioResult]:
        raise NotImplementedError("Qwen3-TTS Base does not support voice design.")        

    def health_check(self) -> bool:
        return self._loaded and self._tts is not None
