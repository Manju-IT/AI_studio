# API Reference

Base URL: `http://127.0.0.1:8000/api/v1`
OpenAPI: `http://127.0.0.1:8000/api/docs`

All authenticated endpoints require the `voice_studio_session` cookie. Obtain it
via `POST /auth/login`.

## Errors

Every error response has the shape:

```json
{ "error": { "code": "MODEL_NOT_INSTALLED", "message": "...", "details": {} } }