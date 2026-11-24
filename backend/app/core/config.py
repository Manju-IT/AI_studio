from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


    app_name: str = "AI Voice Studio"
    app_env: Literal["local", "test", "production"] = "local"
    debug: bool = False
    host: str = "127.0.0.1"
    port: int = 8000
    frontend_origin: str = "http://localhost:3000"

    database_url: str = (
        "postgresql+asyncpg://postgres:123@localhost:5432/voice_studio"
    )
    db_echo: bool = False

    secret_key: str = Field(min_length=32)
    session_cookie_name: str = "voice_studio_session"
    session_max_age_seconds: int = 86400
    argon2_time_cost: int = 3
    argon2_memory_cost: int = 65536
    argon2_parallelism: int = 2

    storage_root: Path = PROJECT_ROOT / "storage"
    model_cache_dir: Path = PROJECT_ROOT / "storage/models"
    generated_audio_dir: Path = PROJECT_ROOT / "storage/generated"
    reference_audio_dir: Path = PROJECT_ROOT / "storage/reference_audio"
    temp_dir: Path = PROJECT_ROOT / "storage/temporary"
    export_dir: Path = PROJECT_ROOT / "storage/exports"
    max_upload_mb: int = 50

    inference_worker_poll_seconds: float = 1.0
    inference_load_timeout_seconds: int = 180
    inference_generation_timeout_seconds: int = 600
    inference_chunk_timeout_seconds: int = 300
    inference_worker_restart_on_timeout: bool = True

    cpu_threads: int = 6
    interop_threads: int = 2
    max_ram_mb_for_inference: int = 9000
    min_free_disk_mb: int = 2048

    longform_max_chars: int = 50000
    longform_chunk_target_chars: int = 350
    longform_chunk_max_chars: int = 600
    longform_pause_ms: int = 350

    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"

    @field_validator(
        "storage_root",
        "model_cache_dir",
        "generated_audio_dir",
        "reference_audio_dir",
        "temp_dir",
        "export_dir",
        mode="before",
    )
    @classmethod
    def _expand_path(cls, value: str | Path) -> Path:
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path.resolve()

    def ensure_dirs(self) -> None:
        for path in (
            self.storage_root,
            self.model_cache_dir,
            self.generated_audio_dir,
            self.reference_audio_dir,
            self.temp_dir,
            self.export_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
