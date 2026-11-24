"""Create the initial company administrator.

Run once after migrations:

    python scripts/bootstrap_admin.py \
        --email admin@company.local \
        --password "a-strong-password" \
        --name "Studio Admin"
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Allow running from repository root without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.session import SessionFactory  # noqa: E402
from app.models.user import User, Workspace, WorkspaceMember  # noqa: E402


async def _bootstrap(email: str, password: str, name: str) -> None:
    settings = get_settings()
    settings.ensure_dirs()

    async with SessionFactory() as session:
        async with session.begin():
            existing = await session.scalar(select(User).where(User.email == email.lower()))
            if existing is not None:
                print(f"User '{email}' already exists. Nothing to do.")
                return

            user = User(
                email=email.lower(),
                display_name=name,
                password_hash=hash_password(password),
                role="admin",
                is_active=True,
            )
            session.add(user)
            await session.flush()

            workspace = await session.scalar(select(Workspace).limit(1))
            if workspace is None:
                workspace = Workspace(name="Company Workspace", slug="company")
                session.add(workspace)
                await session.flush()

            session.add(
                WorkspaceMember(
                    workspace_id=workspace.id,
                    user_id=user.id,
                    role="admin",
                )
            )

    print(f"Admin '{email}' created in workspace 'Company Workspace'.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap the initial AI Voice Studio admin.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--name", default="Studio Admin")
    args = parser.parse_args()

    if len(args.password) < 10:
        print("Password must be at least 10 characters.", file=sys.stderr)
        raise SystemExit(2)

    asyncio.run(_bootstrap(args.email, args.password, args.name))


if __name__ == "__main__":
    main()