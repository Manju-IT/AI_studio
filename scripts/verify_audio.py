"""CLI smoke-test: list recent completed jobs and play the newest audio.

Usage:
    python scripts/verify_audio.py            # play the latest
    python scripts/verify_audio.py --list     # list the last 10 without playing
    python scripts/verify_audio.py --id <asset_id>  # play a specific asset

Relies on the OS default audio player via `start`, `open`, or `xdg-open`.
"""

from __future__ import annotations

import argparse
import asyncio
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import select  # noqa: E402

from app.db.session import SessionFactory  # noqa: E402
from app.models.audio import AudioAsset  # noqa: E402
from app.models.job import GenerationJob  # noqa: E402


async def _list(limit: int) -> list[tuple[GenerationJob, AudioAsset | None]]:
    async with SessionFactory() as session:
        jobs = (
            await session.scalars(
                select(GenerationJob)
                .where(GenerationJob.status == "completed")
                .order_by(GenerationJob.created_at.desc())
                .limit(limit)
            )
        ).all()
        results: list[tuple[GenerationJob, AudioAsset | None]] = []
        for job in jobs:
            asset = (
                await session.scalar(
                    select(AudioAsset).where(AudioAsset.id == job.audio_asset_id)
                )
                if job.audio_asset_id
                else None
            )
            results.append((job, asset))
        return results


async def _fetch_asset(asset_id: str) -> AudioAsset | None:
    async with SessionFactory() as session:
        return await session.scalar(select(AudioAsset).where(AudioAsset.id == asset_id))


def _play(path: Path) -> None:
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(2)
    print(f"Playing: {path}")
    if sys.platform.startswith("win"):
        subprocess.run(["cmd", "/c", "start", "", str(path)], check=False)
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


async def main() -> None:
    parser = argparse.ArgumentParser(description="List recent completed jobs or play audio.")
    parser.add_argument("--list", action="store_true", help="List instead of playing.")
    parser.add_argument("--id", help="Play a specific asset id instead of the latest.")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    if args.id:
        asset = await _fetch_asset(args.id)
        if asset is None:
            print(f"No asset with id {args.id}", file=sys.stderr)
            sys.exit(1)
        _play(Path(asset.storage_path))
        return

    rows = await _list(args.limit)
    if not rows:
        print("No completed jobs found. Generate something in the Studio first.")
        return

    if args.list:
        for job, asset in rows:
            print(
                f"{job.id}  {job.status:<10}  "
                f"{asset.duration_seconds if asset else 0:.1f}s  "
                f"{job.text[:60]!r}"
            )
        return

    job, asset = rows[0]
    if asset is None:
        print(f"Latest job {job.id} has no asset.", file=sys.stderr)
        sys.exit(1)
    print(f"Latest job {job.id} · {asset.duration_seconds:.1f}s · {asset.title or asset.original_filename}")
    _play(Path(asset.storage_path))


if __name__ == "__main__":
    asyncio.run(main())