from datetime import datetime, timedelta, timezone
from typing import Literal
import uuid
from fastapi import APIRouter, Depends, HTTPException, Response, BackgroundTasks, Form, File, UploadFile, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import current_user, db_session
from app.api.v1 import generations, audio, transcriptions, models, voices
from app.core.developer_keys import SCOPES, digest_key, issue_key
from app.models.api_key import DeveloperKey
from app.models.user import User
from app.schemas.job import GenerationSubmitRequest, GenerationJobOut

router = APIRouter()
external = APIRouter()
bearer = HTTPBearer(auto_error=False, scheme_name='DeveloperKey')
Scope = Literal['catalog:read','tts:write','tts:read','audio:read','asr:write','asr:read']

class KeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scopes: list[Scope] = Field(min_length=1, max_length=6)
    expires_days: int = Field(default=90, ge=1, le=365)

class KeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    prefix: str
    scopes: list[str]
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    last_used_at: datetime | None
    request_count: int

class KeyIssued(KeyOut):
    secret: str

@router.get('/keys', response_model=list[KeyOut])
async def list_keys(user: User = Depends(current_user), db: AsyncSession = Depends(db_session)):
    return (await db.scalars(select(DeveloperKey).where(DeveloperKey.owner_id == user.id).order_by(DeveloperKey.created_at.desc()))).all()

@router.post('/keys', response_model=KeyIssued, status_code=201)
async def create_key(payload: KeyCreate, response: Response, user: User = Depends(current_user), db: AsyncSession = Depends(db_session)):
    if not payload.name.strip(): raise HTTPException(422, 'Name is required')
    secret = issue_key()
    key = DeveloperKey(owner_id=user.id, name=payload.name.strip(), prefix=secret[:12], digest=digest_key(secret), scopes=sorted(set(payload.scopes)), expires_at=datetime.now(timezone.utc)+timedelta(days=payload.expires_days))
    db.add(key)
    await db.commit()
    await db.refresh(key)
    response.headers['Cache-Control'] = 'no-store'
    return KeyIssued(**KeyOut.model_validate(key).model_dump(), secret=secret)

@router.delete('/keys/{key_id}', status_code=204)
async def revoke_key(key_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(db_session)):
    result = await db.execute(update(DeveloperKey).where(DeveloperKey.id==key_id, DeveloperKey.owner_id==user.id).values(revoked_at=datetime.now(timezone.utc)))
    if not result.rowcount: raise HTTPException(404, 'Key not found')
    await db.commit()
    return Response(status_code=204)

def require(scope: str):
    assert scope in SCOPES
    async def authenticate(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: AsyncSession = Depends(db_session)) -> User:
        if credentials is None or not credentials.credentials.startswith('avs_') or len(credentials.credentials)!=47:
            raise HTTPException(401, 'Invalid API key', headers={'WWW-Authenticate':'Bearer'})
        now = datetime.now(timezone.utc)
        key = await db.scalar(select(DeveloperKey).where(DeveloperKey.digest==digest_key(credentials.credentials), DeveloperKey.revoked_at.is_(None), DeveloperKey.expires_at>now))
        if key is None: raise HTTPException(401, 'Invalid or expired API key', headers={'WWW-Authenticate':'Bearer'})
        user = await db.get(User, key.owner_id)
        if user is None or not user.is_active: raise HTTPException(401, 'Inactive account')
        if scope not in key.scopes: raise HTTPException(403, 'Missing scope: '+scope)
        result = await db.execute(update(DeveloperKey).where(DeveloperKey.id==key.id, DeveloperKey.revoked_at.is_(None), DeveloperKey.expires_at>now).values(last_used_at=now, request_count=DeveloperKey.request_count+1))
        if not result.rowcount: raise HTTPException(401, 'Inactive API key')
        await db.commit()
        return user
    return authenticate

@external.get('/models')
async def catalog(user: User = Depends(require('catalog:read')), db: AsyncSession = Depends(db_session)):
    rows = await models.list_models(user, db)
    return [dict(id=r.id, name=r.definition.display_name, runtime=r.runtime, languages=r.definition.languages, installation_state=r.installation_state, generation_contract=r.generation_contract) for r in rows]

@external.get('/voices')
async def voice_catalog(language: str | None = None, user: User = Depends(require('catalog:read')), db: AsyncSession = Depends(db_session)):
    rows = await voices.list_voices(language, user, db)
    return [dict(id=r.id, name=r.name, language=r.language, model_installation_id=r.model_installation_id) for r in rows if r.synthesis_ready]

@external.post('/tts', status_code=202, response_model=GenerationJobOut)
async def submit_tts(payload: GenerationSubmitRequest, user: User = Depends(require('tts:write')), db: AsyncSession = Depends(db_session)):
    return await generations.submit_generation(payload, user, db)

@external.get('/tts/{job_id}', response_model=GenerationJobOut)
async def get_tts(job_id: uuid.UUID, user: User = Depends(require('tts:read')), db: AsyncSession = Depends(db_session)):
    return await generations.get_generation(job_id, user, db)

@external.post('/tts/{job_id}/cancel', response_model=GenerationJobOut)
async def cancel_tts(job_id: uuid.UUID, user: User = Depends(require('tts:write')), db: AsyncSession = Depends(db_session)):
    return await generations.cancel_generation(job_id, user, db)

@external.get('/audio/{asset_id}/download')
async def download(asset_id: uuid.UUID, user: User = Depends(require('audio:read')), db: AsyncSession = Depends(db_session)):
    return await audio.download_audio(asset_id, user, db)

@external.post('/asr', status_code=202)
async def submit_asr(background: BackgroundTasks, model: Literal['tiny','base'] = Form('tiny'), language: str = Form('auto'), diarization: bool = Form(False), speakers: int = Form(0, ge=0, le=10), asset_id: uuid.UUID | None = Form(None), file: UploadFile | None = File(None), user: User = Depends(require('asr:write')), db: AsyncSession = Depends(db_session)):
    return await transcriptions.submit(background=background, model=model, language=language, diarization=diarization, speakers=speakers, asset_id=asset_id, file=file, user=user, session=db)

@external.get('/asr/{job_id}')
async def get_asr(job_id: uuid.UUID, user: User = Depends(require('asr:read'))):
    return await transcriptions.detail(job_id, user)
