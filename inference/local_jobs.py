import asyncio
import sys
import uuid
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.db.session import SessionFactory
from app.models.voice import Voice, VoiceAuthorization
from app.models.model import ModelInstallation
from app.services.jobs.local_queue import save, load
from app.services.voice_extraction import extract


async def process(path, data):
    from app.services.jobs.queue_controls import transition
    try:
        data = transition(path, {'queued'}, 'processing')
    except ValueError:
        return
    result_path = path.with_suffix('.result')
    try:
        if data.get('kind') == 'extract':
            async with SessionFactory() as session:
                voice = await session.scalar(select(Voice).options(selectinload(Voice.samples)).where(Voice.id == uuid.UUID(data['voice_id']), Voice.owner_id == uuid.UUID(data['owner_id']), Voice.is_active.is_(True)))
                if not voice or voice.source != 'cloned': raise ValueError('Voice unavailable')
                auth = await session.scalar(select(VoiceAuthorization).where(VoiceAuthorization.voice_id == voice.id))
                model = await session.get(ModelInstallation, voice.model_installation_id)
                samples = sorted((s for s in voice.samples if s.is_reference), key=lambda s:s.created_at, reverse=True)
                if not auth or not model or model.runtime != 'qwen_mnn' or not samples: raise ValueError('Missing reference, authorization or model')
                transcript = (auth.consent_metadata or {}).get('reference_text', '').strip()
                if not transcript: raise ValueError('Missing transcript')
                args = (voice.id, samples[0].storage_path, transcript)
            await asyncio.to_thread(extract, *args)
        elif data.get('kind') == 'asr':
            child = await asyncio.create_subprocess_exec(sys.executable, '-m', 'inference.local_job_child', str(path), str(result_path))
            try:
                code = await asyncio.wait_for(child.wait(), timeout=7200)
            finally:
                if child.returncode is None:
                    child.kill()
                    await child.wait()
            if code: raise ValueError(f'Transcription process exited {code}')
            data.update(load(result_path))
        else:
            raise ValueError('Legacy job has no durable source; submit again')
        data.update(status='completed', error=None)
    except Exception as exc:
        data.update(status='failed', error=str(exc)[:300] if isinstance(exc, ValueError) else f'Job failed ({type(exc).__name__})')
    finally:
        try:
            result_path.unlink(missing_ok=True)
            if data.get('status') == 'completed' and data.get('cleanup') and data.get('source'):
                Path(data['source']).unlink(missing_ok=True)
        finally:
            save(path, data)
