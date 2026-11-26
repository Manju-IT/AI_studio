"""Bounded, non-destructive PCM processing."""
import numpy as np
import soundfile as sf


def process(source, output, operation, value):
    with sf.SoundFile(str(source)) as f:
        if f.frames * f.channels > 12_000_000 or f.channels > 2:
            raise ValueError('Processing supports mono/stereo clips up to 12 million samples.')
        rate = f.samplerate
        x = f.read(dtype='float32', always_2d=True)
    if not len(x) or not np.isfinite(x).all():
        raise ValueError('Empty or invalid audio.')
    if operation == 'normalize':
        peak = np.max(np.abs(x))
        if peak > 0: x *= 10**(value/20)/peak
    elif operation == 'gain': x *= 10**(value/20)
    elif operation in ('fade_in','fade_out'):
        n = min(len(x), max(1, round(value*rate)))
        ramp = np.linspace(0,1,n,dtype='float32')[:,None]
        if operation == 'fade_in': x[:n] *= ramp
        else: x[-n:] *= ramp[::-1]
    elif operation == 'trim_silence':
        indices = np.flatnonzero(np.max(np.abs(x),axis=1) >= 10**(value/20))
        if not len(indices): raise ValueError('No audio above threshold.')
        x = x[indices[0]:indices[-1]+1]
    elif operation == 'mono': x = x.mean(axis=1,keepdims=True)
    elif operation == 'stereo':
        if x.shape[1]==1: x = np.repeat(x,2,axis=1)
    else: raise ValueError('Unsupported operation.')
    sf.write(str(output),np.clip(x,-1,1),rate,subtype='PCM_16')
