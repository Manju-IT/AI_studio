"""Private Qwen profile validation; no inference model is loaded here."""
import json
from pathlib import Path
import numpy as np
from app.core.config import get_settings


def profile_path(voice_id):
    return get_settings().storage_root / 'private_voices' / str(voice_id)


def validate(root, normalize=False):
    root = Path(root)
    meta = json.loads((root / 'meta.json').read_text(encoding='utf-8'))
    ids = np.asarray(meta['ref_ids'])
    if ids.dtype.kind not in 'iu' or ids.ndim < 1 or any(n != 1 for n in ids.shape[:-1]) or ids.size <= 5 or np.any(ids < 0) or np.any(ids >= 151936):
        raise ValueError('Invalid reference tokens')
    frames = meta['ref_frames']
    if type(frames) is not int or not 1 <= frames <= 2000:
        raise ValueError('Invalid frame count')
    c, e = root/'ref_code.i32.bin', root/'spk_emb.f32.bin'
    if c.stat().st_size != frames*64 or e.stat().st_size != 4096:
        raise ValueError('Invalid asset sizes')
    codes, emb = np.fromfile(c, dtype='<i4'), np.fromfile(e, dtype='<f4')
    if np.any(codes < 0) or np.any(codes >= 2048) or not np.isfinite(emb).all() or not np.any(emb):
        raise ValueError('Invalid voice assets')
    if ids.shape != (1, ids.size):
        if not normalize: raise ValueError('Reference metadata requires normalization')
        meta['ref_ids'] = [ids.reshape(-1).tolist()]
        (root/'meta.json').write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')


def ready(voice):
    if voice.source == 'builtin': return True
    if voice.source != 'cloned' or voice.owner_id is None: return False
    try:
        validate(profile_path(voice.id))
        return True
    except (OSError, ValueError, TypeError, KeyError):
        return False


def usable(voice, owner, model):
    return bool(voice and voice.is_active and voice.model_installation_id == model.id and ((voice.source == 'builtin' and voice.owner_id in (None, owner)) or (voice.source == 'cloned' and voice.owner_id == owner and model.runtime == 'qwen_mnn' and ready(voice))))
