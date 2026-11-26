import hashlib
import secrets

SCOPES = ('catalog:read', 'tts:write', 'tts:read', 'audio:read', 'asr:write', 'asr:read')

def digest_key(secret: str) -> str:
    return hashlib.sha256(secret.encode('utf-8')).hexdigest()

def issue_key() -> str:
    return 'avs_' + secrets.token_urlsafe(32)
