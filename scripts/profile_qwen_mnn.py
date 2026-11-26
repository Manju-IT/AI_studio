from pathlib import Path
import argparse
import time
import json
from collections import defaultdict
from qwen3_tts_mnn import Qwen3TtsMnn
import numpy as np
import soundfile as sf


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--voice', default='voice_priya')
    p.add_argument('--threads', type=int, default=6)
    p.add_argument('--repeats', type=int, default=3)
    p.add_argument('--text', default='Hello. Welcome to AI Voice Studio.')
    a = p.parse_args()
    root = Path('storage/models/qwen3-tts-0.6b-base-mnn')
    t = Qwen3TtsMnn(str(root), num_threads=a.threads, language='english', backend='pymnn')
    try:
        t.load_voice(str(root / a.voice))
        print('Unrolled predictor:', t._cpu is not None)
        times = defaultdict(float)
        calls = defaultdict(int)
        def wrap(obj, attr, name):
            original = getattr(obj, attr)
            def measured(*args, **kwargs):
                start = time.perf_counter()
                try:
                    return original(*args, **kwargs)
                finally:
                    times[name] += time.perf_counter() - start
                    calls[name] += 1
            setattr(obj, attr, measured)
        wrap(t, '_build_prefill', 'prefill_embeddings')
        wrap(t._talker, 'run', 'talker')
        wrap(t._cpu if t._cpu is not None else t._cp, 'run', 'predictor')
        wrap(t, 'codes_to_wav', 'vocoder')
        for i in range(a.repeats):
            times.clear(); calls.clear()
            start = time.perf_counter()
            pcm = t.synthesize(a.text, seed=42, temperature=.7, top_k=50, top_p=.9, repetition_penalty=1.1)
            elapsed = time.perf_counter()-start
            if not len(pcm) or not np.isfinite(pcm).all():
                raise RuntimeError('Invalid audio')
            print(json.dumps(dict(run=i+1, seconds=elapsed, audio_seconds=len(pcm)/24000, rtf=elapsed/(len(pcm)/24000), stage_seconds=dict(times), stage_calls=dict(calls), other_seconds=elapsed-sum(times.values())), indent=2), flush=True)
            sf.write(f'qwen_profile_{i+1}.wav', pcm, 24000)
    finally:
        t.close()

if __name__ == '__main__':
    main()
