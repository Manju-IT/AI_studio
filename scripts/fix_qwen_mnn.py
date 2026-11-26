"""
Fix Qwen3-TTS MNN reference token dimensionality.

Preserves the original engine.py.
Does not modify model weights or voice profiles.
"""

import ast
import shutil
import importlib.util
from pathlib import Path


def main():

    spec = importlib.util.find_spec("qwen3_tts_mnn")

    if spec is None or spec.origin is None:
        raise RuntimeError("qwen3_tts_mnn is not installed.")

    engine = Path(spec.origin).parent / "engine.py"

    if not engine.is_file():
        raise FileNotFoundError(engine)

    print("Runtime file:", engine)

    source = engine.read_text(encoding="utf-8")

    marker = "# QWEN_REFERENCE_DIMENSION_FIX"

    if marker in source:
        print("Patch already applied.")
        return

    old = "icl_ids = np.concatenate([ref_ids[3:-2], text_ids[3:-5]], -1)"

    lines = source.splitlines(keepends=True)

    matches = [i for i, line in enumerate(lines) if line.strip() == old]

    if len(matches) != 1:
        raise RuntimeError(
            "Expected source line not found uniquely. "
            "The installed runtime version may differ. "
            "No changes were made."
        )

    index = matches[0]

    original_line = lines[index]

    indent = original_line[: len(original_line) - len(original_line.lstrip())]

    replacement = [
        marker,
        "ref_ids = np.asarray(ref_ids)",
        "text_ids = np.asarray(text_ids)",
        "",
        "if ref_ids.ndim == 2 and ref_ids.shape[0] == 1:",
        "    ref_ids = ref_ids.squeeze(axis=0)",
        "",
        "if text_ids.ndim == 2 and text_ids.shape[0] == 1:",
        "    text_ids = text_ids.squeeze(axis=0)",
        "",
        "if ref_ids.ndim != 1 or text_ids.ndim != 1:",
        "    raise ValueError(",
        '        f"Unexpected token shapes: "',
        '        f"reference={ref_ids.shape}, "',
        '        f"text={text_ids.shape}"',
        "    )",
        "",
        "icl_ids = np.concatenate(",
        "    [ref_ids[3:-2], text_ids[3:-5]],",
        "    axis=-1,",
        ")",
    ]

    lines[index] = "".join(indent + line + "\n" for line in replacement)

    updated = "".join(lines)

    # Verify syntax before modifying the runtime.
    ast.parse(updated)

    backup = engine.with_suffix(".py.bak")

    if not backup.exists():
        shutil.copy2(engine, backup)

    temporary = engine.with_suffix(".py.tmp")

    temporary.write_text(updated, encoding="utf-8")

    temporary.replace(engine)

    print("=" * 60)
    print("PATCH APPLIED SUCCESSFULLY")
    print("=" * 60)

    print("Original backup:", backup)
    print("Patched runtime:", engine)
    print("Python syntax validation: PASSED")

    print("\nRun scripts/test_qwen_mnn.py again.")


if __name__ == "__main__":
    main()
