from __future__ import annotations

import faulthandler
import sys
from pathlib import Path

faulthandler.enable(all_threads=True)

import MNN
import psutil


ROOT = Path(__file__).resolve().parents[1]

MODEL = (
    ROOT
    / "storage"
    / "models"
    / "qwen3-tts-0.6b-base-mnn"
    / "cp_step.mnn"
)


def log(*args):
    print(*args, flush=True)


def memory():
    process = psutil.Process()

    log(
        "Process RAM:",
        round(process.memory_info().rss / 1024**3, 3),
        "GiB",
    )


def main():

    log("=" * 65)
    log("MNN SHARED RUNTIME ISOLATED TEST")
    log("=" * 65)

    if not MODEL.is_file():
        raise FileNotFoundError(MODEL)

    config = {
        "numThread": 4,
    }

    log("\nSTEP 1: Creating interpreter")

    interpreter = MNN.Interpreter(str(MODEL))

    log("Interpreter created")
    memory()

    log("\nSTEP 2: Creating shared runtime")

    runtime = interpreter.createRuntime(
        (config,)
    )

    log("Runtime type:", type(runtime).__name__)
    log("Runtime representation:", repr(runtime))

    if isinstance(runtime, tuple):

        log("Runtime tuple length:", len(runtime))

        for index, item in enumerate(runtime):

            log(
                f"Runtime[{index}]",
                "type:", type(item).__name__,
                "value:", repr(item),
            )

    memory()

    log("\nSTEP 3: Creating first shared session")

    session = interpreter.createSession(
        config,
        runtime,
    )

    log("Session created:", type(session).__name__)

    memory()

    log("\nSTEP 4: Reading input tensors")

    inputs = interpreter.getSessionInputAll(session)

    for name, tensor in inputs.items():

        log(
            "Input:",
            name,
            "Shape:",
            tensor.getShape(),
        )

    log("\nSTEP 5: Resizing input tensors")

    shapes = {
        "inputs_embeds": (1, 2, 1024),
        "position_ids": (1, 2),
        "past_kv": (10, 1, 8, 0, 128),
    }

    for name, shape in shapes.items():

        log("Getting tensor:", name)

        tensor = interpreter.getSessionInput(
            session,
            name,
        )

        log("Resizing tensor:", name, shape)

        interpreter.resizeTensor(
            tensor,
            shape,
        )

        log("Tensor resized:", name)

    log("\nSTEP 6: Resizing session")

    interpreter.resizeSession(session)

    log("Session resized successfully")

    memory()

    log("\nSTEP 7: Creating second shared session")

    second_session = interpreter.createSession(
        config,
        runtime,
    )

    log(
        "Second session created:",
        type(second_session).__name__,
    )

    memory()

    log("\n" + "=" * 65)
    log("SHARED SESSION INITIALIZATION SUCCESSFUL")
    log("=" * 65)

    # Keep the runtime and sessions alive until
    # all initialization checks have completed.
    return 0


if __name__ == "__main__":
    sys.exit(main())