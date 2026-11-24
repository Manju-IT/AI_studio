from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Protocol, runtime_checkable

from inference.contracts.types import (
    AudioResult,
    Capability,
    ModelManifest,
    TTSRequest,
    VoiceDescriptor,
)


@runtime_checkable
class TTSEngine(Protocol):
    """Every adapter must implement this contract completely for the capabilities it advertises."""

    @property
    def manifest(self) -> ModelManifest: ...

    def load(self) -> None: ...

    def unload(self) -> None: ...

    def is_loaded(self) -> bool: ...

    def capabilities(self) -> frozenset[Capability]: ...

    def supported_languages(self) -> tuple[str, ...]: ...

    def available_voices(self) -> list[VoiceDescriptor]: ...

    def generate(self, request: TTSRequest) -> AudioResult: ...

    async def stream(
        self,
        request: TTSRequest,
    ) -> AsyncIterator[AudioResult]: ...

    def clone_voice(
        self,
        reference_audio: Path,
        reference_text: str,
        voice_name: str,
        consent_metadata: dict,
    ) -> VoiceDescriptor: ...

    def design_voice(
        self,
        description: str,
        language: str,
        preview_text: str,
    ) -> tuple[VoiceDescriptor, AudioResult]: ...

    def health_check(self) -> bool: ...