from __future__ import annotations
import asyncio
import logging
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import current_user, db_session
from app.core.config import get_settings
from app.models.audio import AudioAsset
from app.models.user import User

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

def folder(owner):
    p = get_settings().storage_root / "transcriptions" / str(owner)
    p.mkdir(parents=True, exist_ok=True)
    return p

from app.services.jobs.local_queue import save, load

def read(owner, job_id):
    p = folder(owner) / f"{job_id}.json"
    if not p.is_file():
        raise HTTPException(404, 'Transcription not found')
    return p, load(p)

@router.get('')
async def history(user: User = Depends(current_user)):
    paths = sorted(folder(user.id).glob('*.json'), key=lambda p:p.stat().st_mtime, reverse=True)[:100]
    return [{k:v for k,v in read(user.id,uuid.UUID(p.stem))[1].items() if k not in ('segments','source','cleanup','kind')} for p in paths]

@router.get('/{job_id}')
async def detail(job_id: uuid.UUID, user: User = Depends(current_user)):
    return {k:v for k,v in read(user.id,job_id)[1].items() if k not in ('source','cleanup','kind')}

@router.post('', status_code=202)
async def submit(background: BackgroundTasks, model: Literal['tiny','base'] = Form('tiny'), language: str = Form('auto'), diarization: bool = Form(False), speakers: int = Form(0, ge=0, le=10), asset_id: uuid.UUID | None = Form(None), file: UploadFile | None = File(None), user: User = Depends(current_user), session: AsyncSession = Depends(db_session)):
    if (file is None) == (asset_id is None): raise HTTPException(400,'Select exactly one audio source')
    if language != 'auto' and (len(language)!=2 or not language.isascii() or not language.isalpha()): raise HTTPException(400,'Invalid language code')
    if sum(load(p).get('status') in ('queued','processing') for p in folder(user.id).glob('*.json'))>=4: raise HTTPException(429,'Transcription queue is full')
    job_id = str(uuid.uuid4()); root = folder(user.id); cleanup = file is not None
    if file is not None:
        source = root / f'{job_id}.upload'; size=0
        try:
            with source.open('wb') as out:
                while chunk := await file.read(1024*1024):
                    size += len(chunk)
                    if size > min(50,get_settings().max_upload_mb)*1024*1024: raise HTTPException(413,'Audio too large')
                    out.write(chunk)
            if not size: raise HTTPException(400,'Empty audio')
        except BaseException:
            source.unlink(missing_ok=True); raise
        finally: await file.close()
        title = Path(file.filename or 'Audio').name[:200]
    else:
        asset = await session.scalar(select(AudioAsset).where(AudioAsset.id==asset_id, AudioAsset.owner_id==user.id))
        if asset is None: raise HTTPException(404,'Audio not found')
        source=Path(asset.storage_path); title=asset.title or asset.original_filename
        if not source.is_file(): raise HTTPException(404,'Audio file missing')
    data=dict(id=job_id,title=title,model=model,requested_language=language,diarization=diarization,speakers=speakers,status='queued',created_at=datetime.now(timezone.utc).isoformat(),segments=[],error=None)
    path=root/f'{job_id}.json'; data.update(kind="asr", source=str(source.resolve()), cleanup=cleanup)
    save(path,data)
    return {k:v for k,v in data.items() if k not in ("source","cleanup","kind")}

class Edit(BaseModel):
    texts: list[str] = Field(max_length=20000)
    speakers: list[str | None] | None = Field(default=None, max_length=20000)

@router.put('/{job_id}')
async def edit(job_id: uuid.UUID, payload: Edit, user: User = Depends(current_user)):
    path,data=read(user.id,job_id)
    if data['status']!='completed' or len(payload.texts)!=len(data['segments']): raise HTTPException(409,'Transcript is not editable or segment count changed')
    if any(len(t)>10000 for t in payload.texts): raise HTTPException(400,'Segment text too long')
    for segment,text in zip(data['segments'],payload.texts): segment['text']=text
    if payload.speakers is not None:
        if len(payload.speakers)!=len(data['segments']) or any(x is not None and len(x)>80 for x in payload.speakers): raise HTTPException(400,'Invalid speaker labels')
        for segment, label in zip(data['segments'], payload.speakers):
            if label is not None: segment['speaker']=label
    save(path,data); return {k:v for k,v in data.items() if k not in ("source","cleanup","kind")}
