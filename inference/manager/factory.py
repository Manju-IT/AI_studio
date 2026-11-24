from __future__ import annotations

from inference.adapters.kokoro_adapter import KokoroAdapter
from inference.adapters.piper_adapter import PiperAdapter
from inference.adapters.qwen_mnn_adapter import QwenMnnAdapter
from inference.contracts.base import TTSEngine
from inference.contracts.types import ModelManifest, Runtime


class AdapterFactoryError(RuntimeError):
    pass


def create_adapter(manifest: ModelManifest) -> TTSEngine:
    """Instantiate the adapter for a manifest's runtime.

    Raises AdapterFactoryError if the runtime has no concrete implementation.
    Only runtimes with a verified adapter are mapped here.
    """
    match manifest.runtime:
        case Runtime.PIPER:
            return PiperAdapter(manifest)
        case Runtime.KOKORO:
            return KokoroAdapter(manifest)
        case Runtime.QWEN_MNN:
            return QwenMnnAdapter(manifest)
        case Runtime.QWEN_NATIVE:
            raise AdapterFactoryError(
                "qwen_native is defined but not yet integrated. "
                "Use qwen_mnn for CPU Qwen3-TTS today."
            )
        case Runtime.QWEN_GGUF:
            raise AdapterFactoryError(
                "qwen_gguf requires a manual GGUF export step. "
                "Not available in this build."
            )
        case Runtime.INDIC:
            raise AdapterFactoryError("Indic TTS adapter is not yet implemented.")
        case _:
            raise AdapterFactoryError(f"No adapter for runtime '{manifest.runtime}'.")