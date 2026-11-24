"""Idempotently register the three built-in model definitions.

Run after `alembic upgrade head` and after `bootstrap_admin.py`:

    python scripts/seed_models.py

Safe to re-run — existing rows are updated in place, never duplicated.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.session import SessionFactory  # noqa: E402
from app.models.model import ModelDefinition, ModelInstallation  # noqa: E402

# Each entry: (definition, installation-or-None)
DEFINITIONS = [
    {
        "slug": "kokoro-82m",
        "display_name": "Kokoro-82M",
        "architecture": "kokoro",
        "model_type": "lightweight",
        "parameters_billions": 0.082,
        "license": "Apache-2.0",
        "source_repository": "https://huggingface.co/hexgrad/Kokoro-82M",
        "languages": ["en", "es", "fr", "de", "it", "pt"],
        "capabilities": {
            "text_to_speech": True,
            "voice_cloning": False,
            "voice_design": False,
            "streaming": False,
            "style_control": False,
            "multilingual": True,
        },
        "installation": {
            "manifest_id": "kokoro-82m-q8",
            "runtime": "kokoro",
            "quantization": "q8",
            "device": "cpu",
            "model_path": "storage/models/kokoro-82m",
            "memory_estimate_mb": 350,
        },
    },
    {
        "slug": "piper-en-us",
        "display_name": "Piper English (US)",
        "architecture": "piper",
        "model_type": "lightweight",
        "parameters_billions": 0.02,
        "license": "MIT",
        "source_repository": "https://github.com/rhasspy/piper",
        "languages": ["en"],
        "capabilities": {
            "text_to_speech": True,
            "voice_cloning": False,
            "voice_design": False,
            "streaming": False,
            "style_control": False,
            "multilingual": False,
        },
        "installation": {
            "manifest_id": "piper-en-us",
            "runtime": "piper",
            "quantization": "fp16",
            "device": "cpu",
            "model_path": "storage/models/piper/en_US-amy-medium",
            "memory_estimate_mb": 120,
        },
    },
    {
        "slug": "qwen3-tts-0.6b-base",
        "display_name": "Qwen3-TTS 0.6B Base (MNN CPU)",
        "architecture": "qwen3_tts",
        "model_type": "base",
        "parameters_billions": 0.6,
        "license": "Apache-2.0",
        "source_repository": "https://modelscope.cn/models/Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        "languages": ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
        "capabilities": {
            "text_to_speech": True,
            "voice_cloning": True,
            "voice_design": False,
            "streaming": False,
            "style_control": True,
            "multilingual": True,
        },
        "installation": {
            "manifest_id": "qwen3-tts-0.6b-base-mnn",
            "runtime": "qwen_mnn",
            "quantization": "fp16",
            "device": "cpu",
            "model_path": "storage/models/qwen3-tts-0.6b-base-mnn",
            "memory_estimate_mb": 2200,
        },
    },
]


async def _seed() -> None:
    settings = get_settings()
    settings.ensure_dirs()
    root = Path(__file__).resolve().parents[1]

    async with SessionFactory() as session:
        async with session.begin():
            for spec in DEFINITIONS:
                installation_spec = spec.pop("installation")
                try:
                    definition = await session.scalar(
                        select(ModelDefinition).where(ModelDefinition.slug == spec["slug"])
                    )
                    if definition is None:
                        definition = ModelDefinition(**spec)
                        session.add(definition)
                        await session.flush()
                        print(f"  created definition: {spec['slug']}")
                    else:
                        for key, value in spec.items():
                            setattr(definition, key, value)
                        print(f"  updated definition: {spec['slug']}")

                    manifest_id = installation_spec["manifest_id"]
                    installation = await session.scalar(
                        select(ModelInstallation).where(
                            ModelInstallation.manifest_id == manifest_id
                        )
                    )
                    if installation is None:
                        # Resolve the path relative to the repository root so this
                        # script works regardless of the current working directory.
                        model_path = Path(installation_spec["model_path"])
                        if not model_path.is_absolute():
                            model_path = (root / model_path).resolve()
                        installation = ModelInstallation(
                            definition_id=definition.id,
                            model_path=str(model_path),
                            **{k: v for k, v in installation_spec.items() if k != "model_path"},
                        )
                        session.add(installation)
                        print(f"  created installation: {manifest_id}")
                    else:
                        print(f"  installation already present: {manifest_id}")
                finally:
                    spec["installation"] = installation_spec


def main() -> None:
    print("Seeding model definitions and installations…")
    asyncio.run(_seed())
    print("Done. Open the Models page in the UI to validate and load.")


if __name__ == "__main__":
    main()