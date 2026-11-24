from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any


class Capability(StrEnum):
    TEXT_TO_SPEECH = "text_to_speech"
    VOICE_CLONING = "voice_cloning"
    VOICE_DESIGN = "voice_design"
    STREAMING = "streaming"
    STYLE_CONTROL = "style_control"
    MULTILINGUAL = "multilingual"


class ModelType(StrEnum):
    CUSTOM_VOICE = "custom_voice"
    BASE = "base"
    VOICE_DESIGN = "voice_design"
    LIGHTWEIGHT = "lightweight"


class Runtime(StrEnum):
    PIPER = "piper"
    KOKORO = "kokoro"
    QWEN_MNN = "qwen_mnn"
    QWEN_NATIVE = "qwen_native"
    QWEN_GGUF = "qwen_gguf"
    INDIC = "indic"


@dataclass(frozen=True)
class VoiceDescriptor:
    id: str
    name: str
    language: str
    gender: str | None = None
    description: str | None = None
    is_cloned: bool = False


@dataclass(frozen=True)
class ModelManifest:
    id: str
    display_name: str
    architecture: str
    parameters_billions: float
    model_type: ModelType
    runtime: Runtime
    quantization: str | None
    device: str
    model_path: str
    capabilities: frozenset[Capability]
    languages: tuple[str, ...]
    license: str
    source_repository: str
    memory_estimate_mb: int | None = None
    max_concurrent_jobs: int = 1
    extra: dict[str, Any] = field(default_factory=dict)

    def supports(self, capability: Capability) -> bool:
        return capability in self.capabilities

    def supports_language(self, lang: str) -> bool:
        return lang.lower() in {x.lower() for x in self.languages}


@dataclass
class TTSRequest:
    text: str
    language: str
    voice_id: str | None = None
    settings: dict[str, Any] = field(default_factory=dict)
    output_path: Path | None = None


@dataclass
class AudioResult:
    audio_path: Path
    duration_seconds: float
    sample_rate: int
    format: str = "wav"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class GenerationProgress:
    current_chunk: int
    total_chunks: int
    message: str