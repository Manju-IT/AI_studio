
from __future__ import annotations

import json
from pathlib import Path

from inference.contracts.types import (
    Capability,
    ModelManifest,
    ModelType,
    Runtime,
)


class ManifestError(ValueError):
    pass


class ManifestRegistry:
    """Discover, validate, and index model manifests."""

    def __init__(self, manifests_dir: Path) -> None:
        self._dir = Path(manifests_dir).resolve()
        self._project_root = self._dir.parent.parent

        self._by_id: dict[str, ModelManifest] = {}
        self._errors: dict[str, list[str]] = {}

        self.scan()

    @property
    def directory(self) -> Path:
        return self._dir

    def _resolve_model_path(self, value: str) -> str:
        path = Path(value).expanduser()

        if not path.is_absolute():
            path = self._project_root / path

        return str(path.resolve())

    def scan(self) -> None:
        self._by_id.clear()
        self._errors.clear()

        if not self._dir.is_dir():
            self._errors["registry"] = [
                f"Manifest directory does not exist: {self._dir}"
            ]
            return

        for path in sorted(self._dir.glob("*.json")):
            try:
                raw = json.loads(
                    path.read_text(encoding="utf-8")
                )

                if not isinstance(raw, dict):
                    raise ManifestError(
                        "Manifest root must be a JSON object."
                    )

                errors = self._validate_raw(raw)

                if errors:
                    self._errors[path.name] = errors
                    continue

                manifest = self._to_manifest(raw)

                if manifest.id in self._by_id:
                    self._errors[path.name] = [
                        f"Duplicate manifest id: {manifest.id}"
                    ]
                    continue

                self._by_id[manifest.id] = manifest

            except Exception as exc:
                self._errors[path.name] = [str(exc)]

    def errors(self) -> dict[str, list[str]]:
        return dict(self._errors)

    def all(self) -> list[ModelManifest]:
        return list(self._by_id.values())

    def get(self, manifest_id: str) -> ModelManifest | None:
        return self._by_id.get(manifest_id)

    def require(self, manifest_id: str) -> ModelManifest:
        manifest = self.get(manifest_id)

        if manifest is None:
            raise ManifestError(
                f"No valid manifest registered with id "
                f"'{manifest_id}'."
            )

        return manifest

    @staticmethod
    def _validate_raw(raw: dict) -> list[str]:
        errors: list[str] = []

        required = {
            "id": str,
            "display_name": str,
            "architecture": str,
            "parameters_billions": (int, float),
            "model_type": str,
            "runtime": str,
            "device": str,
            "model_path": str,
            "capabilities": list,
            "languages": list,
            "license": str,
            "source_repository": str,
        }

        for key, expected in required.items():
            if key not in raw:
                errors.append(f"Missing field '{key}'.")
                continue

            if not isinstance(raw[key], expected):
                errors.append(
                    f"Field '{key}' has wrong type "
                    f"{type(raw[key]).__name__}."
                )

        if errors:
            return errors

        try:
            ModelType(raw["model_type"])
        except ValueError:
            errors.append(
                f"Unknown model_type '{raw['model_type']}'."
            )

        try:
            Runtime(raw["runtime"])
        except ValueError:
            errors.append(
                f"Unknown runtime '{raw['runtime']}'."
            )

        for capability in raw["capabilities"]:
            try:
                Capability(capability)
            except (ValueError, TypeError):
                errors.append(
                    f"Unknown capability '{capability}'."
                )

        if not raw["languages"]:
            errors.append("'languages' cannot be empty.")

        if not raw["model_path"].strip():
            errors.append("'model_path' cannot be empty.")

        return errors

    def _to_manifest(self, raw: dict) -> ModelManifest:
        return ModelManifest(
            id=raw["id"],
            display_name=raw["display_name"],
            architecture=raw["architecture"],
            parameters_billions=float(
                raw["parameters_billions"]
            ),
            model_type=ModelType(raw["model_type"]),
            runtime=Runtime(raw["runtime"]),
            quantization=raw.get("quantization"),
            device=raw["device"],
            model_path=self._resolve_model_path(
                raw["model_path"]
            ),
            capabilities=frozenset(
                Capability(value)
                for value in raw["capabilities"]
            ),
            languages=tuple(raw["languages"]),
            license=raw["license"],
            source_repository=raw["source_repository"],
            memory_estimate_mb=raw.get(
                "memory_estimate_mb"
            ),
            max_concurrent_jobs=int(
                raw.get("max_concurrent_jobs", 1)
            ),
            extra=dict(raw.get("extra") or {}),
        )
