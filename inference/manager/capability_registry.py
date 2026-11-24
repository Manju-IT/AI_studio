"""Runtime parameter contracts. Register new adapters here and in factory.py."""
from math import isfinite
from copy import deepcopy


def parameter(key, label, default, minimum, maximum, step, integer=False):
    return dict(key=key, label=label, default=default, minimum=minimum,
                maximum=maximum, step=step, integer=integer)


REGISTRY = {
    "piper": [parameter("length_scale", "Speech length scale (lower is faster)", 1.0, .5, 2, .05),
              parameter("noise_scale", "Voice variation", .667, 0, 1, .01),
              parameter("noise_w", "Duration variation", .8, 0, 1, .01),
              parameter("volume", "Volume", 1.0, 0, 2, .05)],
    "kokoro": [parameter("speed", "Speech speed", 1.0, .5, 2, .1)],
    "qwen_mnn": [parameter("temperature", "Temperature", .7, .01, 2, .05),
                 parameter("top_p", "Top-p", .9, .01, 1, .01),
                 parameter("top_k", "Top-k", 50, 1, 1000, 1, True),
                 parameter("repetition_penalty", "Repetition penalty", 1.1, 1, 2, .05),
                 parameter("seed", "Seed (optional)", None, 0, 2147483647, 1, True)],
}


def describe_runtime(runtime):
    return {"available": runtime in REGISTRY, "parameters": deepcopy(REGISTRY.get(runtime, []))}


def validate_settings(runtime, settings):
    if runtime not in REGISTRY:
        raise ValueError(f"Runtime {runtime} is not implemented.")
    specs = {p["key"]: p for p in REGISTRY[runtime]}
    result = {}
    for key, value in settings.items():
        if key not in specs:
            raise ValueError(f"Unsupported generation parameter: {key}")
        spec = specs[key]
        if value is None and spec["default"] is None:
            continue
        if type(value) not in (int, float) or not isfinite(value):
            raise ValueError(f"{key} must be a finite number.")
        if not spec["minimum"] <= value <= spec["maximum"]:
            raise ValueError(f"{key} must be between {spec['minimum']} and {spec['maximum']}.")
        if spec["integer"] and int(value) != value:
            raise ValueError(f"{key} must be a whole number.")
        result[key] = int(value) if spec["integer"] else float(value)
    return result
