"""AI Voice Studio inference package.

The worker and its dependencies import ``app.*`` modules that live under
``backend/``. When this package is imported from the repository root (the
canonical entry point for ``python -m inference.worker``), ``backend/`` is
not on ``sys.path`` unless the backend was ``pip install -e``'d. Rather than
requiring that, we insert it here exactly once. This makes
``python -m inference.worker`` work from a fresh clone with only the backend
requirements installed.
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1] / "backend"
if _BACKEND.is_dir() and str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

del sys, Path, _BACKEND