import argparse
from faster_whisper import WhisperModel
from app.core.config import get_settings
p=argparse.ArgumentParser(); p.add_argument('model',choices=['tiny','base']); args=p.parse_args()
WhisperModel(args.model,device='cpu',compute_type='int8',download_root=str(get_settings().model_cache_dir / 'whisper'))
print('Model downloaded:',args.model)
