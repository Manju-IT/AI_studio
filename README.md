# AI Voice Studio — Local, Multi-Model TTS Platform

Company-internal, localhost-only voice platform. No payments, no credits, no cloud inference.

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16
- **Frontend:** Next.js 16, TypeScript, Tailwind CSS, TanStack Query
- **Inference:** Model-agnostic adapters — Piper, Kokoro, Qwen3-TTS (MNN / PyTorch / GGUF)
- **Queue:** PostgreSQL-backed persistent job queue + one isolated worker process
- **Audio:** FFmpeg + SoundFile

## Quick start (Windows PowerShell)

```powershell
# 1. Clone and enter
git clone <repo> ai-voice-studio
cd ai-voice-studio

# 2. Backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"

# 3. Database
# Ensure PostgreSQL 16 is running, then:
createdb -U postgres voice_studio
$env:DATABASE_URL="postgresql+asyncpg://voiceuser:voicepass@localhost:5432/voice_studio"
alembic upgrade head

# 4. Frontend
cd frontend
npm install
npm run dev


python scripts/bootstrap_admin.py --email admin@123 --password "StudioAdmin@2026" --name "Studio Admin"

{
  "email": "admin@example.com",
  "password": "StudioAdmin@2026"
}


python scripts/bootstrap_admin.py \
  --email admin@example.com \
  --password "StudioAdmin@2026" \
  --name "Studio Admin"