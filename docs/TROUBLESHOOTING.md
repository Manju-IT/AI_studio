# Troubleshooting

## "No models registered" in the UI

Run `python scripts/seed_models.py`. It inserts the definition and installation
rows. Then validate via `POST /models/{manifest_id}/validate`.

## Job stays `queued` forever

- Is the worker running? `python -m inference.worker` in a separate terminal.
- Check `storage/temporary/worker_heartbeat`. It should update every ~1 s.
- If the heartbeat is stale, the worker crashed. Restart it; `recover_orphaned_jobs`
  runs on startup and will requeue `running` jobs.

## Job fails with `MODEL_LOAD_FAILED`

The adapter raised during `load()`. The error message in `generation_jobs.error_message`
is the adapter's exception. Common causes:

- **Kokoro:** first run needs internet to download the ONNX model. Once cached
  under `storage/models/kokoro-82m`, subsequent loads are offline.
- **Piper:** `en_US-amy-medium.onnx` or `config.json` missing. See
  `docs/MODEL_SETUP.md`.
- **Qwen MNN:** the ~1.9 GB MNN assets are not in the pip package. Download them
  separately.

## "Not enough RAM" (`INSUFFICIENT_MEMORY`)

`ModelManager` refuses to load a model when `available_mb < estimate * 1.2` or
when the estimate exceeds `MAX_RAM_MB_FOR_INFERENCE`. Close Chrome, unload any
other model, then retry. A 1.7B model will exceed this budget under normal
Windows usage.

## SSE progress bar never updates

- Browser DevTools → Network → check that `/api/v1/jobs/{id}/events` is open.
- If it shows `net::ERR_INCOMPLETE_CHUNKED_ENCODING`, your reverse proxy is
  buffering. On localhost this should not happen; check any dev proxy.
- The frontend falls back to 1.5 s polling automatically if SSE fails.

## `pytest` skips all tests

`TEST_DATABASE_URL` is unset. Set it to a dedicated database, e.g.
`postgresql+asyncpg://voiceuser:voicepass@localhost:5432/voice_studio_test`, and
create that database first.

## `POST /audio/export` with `format=mp3` returns 422 "FFmpeg is required"

Install FFmpeg and put it on `PATH`, or set `FFMPEG_BINARY` to its full path.
WAV export works without FFmpeg.

## Voice cloning upload returns 422 "too short"

The reference must be at least 1 second. Qwen MNN extraction quality degrades
badly below 3 seconds; use 5–15 s for best results.

## "A user with email … already exists" on create

The endpoint returns 409 rather than silently overwriting. Change the email or
use `PATCH /auth/users/{id}` to reactivate the existing user.

## Worker logs `manifest_errors`

One or more files under `model_registry/manifests/` failed validation. The
worker logs the filenames. Common causes: invalid `runtime`, unknown
`capabilities` value, missing `model_path`. The manifest schema is documented
in `inference/manager/registry.py`.