
"""Run speaker diarization and write JSON output."""
import argparse
import json
import os
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("output")
    parser.add_argument("--speakers", type=int, default=0)
    args = parser.parse_args()

    import torch
    import soundfile as sf
    from pyannote.audio import Pipeline

    torch.set_num_threads(4)

    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=os.getenv("HF_TOKEN")
    )

    if pipeline is None:
        raise RuntimeError("Could not load diarization model")

    pipeline.to(torch.device("cpu"))

    samples, rate = sf.read(
        args.audio,
        dtype="float32",
        always_2d=True
    )

    audio = {
        "waveform": torch.from_numpy(samples.T.copy()),
        "sample_rate": rate
    }

    kwargs = {"num_speakers": args.speakers} if args.speakers else {}

    turns = pipeline(audio, **kwargs)

    # Support both older and newer Pyannote output formats.
    annotation = getattr(turns, "speaker_diarization", turns)

    if hasattr(annotation, "itertracks"):
        result = [
            {
                "start": float(turn.start),
                "end": float(turn.end),
                "speaker": str(speaker)
            }
            for turn, _, speaker in annotation.itertracks(yield_label=True)
        ]
    else:
        raise RuntimeError(
            f"Unexpected diarization output: {type(annotation).__name__}"
        )

    Path(args.output).write_text(
        json.dumps(result, indent=2),
        encoding="utf-8"
    )

    print(f"Successfully detected {len(result)} speaker segments.")


if __name__ == "__main__":
    main()
