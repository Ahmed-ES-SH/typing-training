"""Phase 2 generator: synthesize, master, and validate the 23 switch WAV files.

Usage:
    python3 generate_switches.py            # generate + validate + report
    python3 generate_switches.py --check    # validate existing files only
"""

from __future__ import annotations

import argparse
import math
import sys
import wave
from pathlib import Path

try:
    from switch_synth import (
        CEILING_DBFS,
        TIER1_PEAK_DBFS,
        TIER2_PEAK_DBFS,
        finalize,
        press_sound,
    )
except ImportError:
    from .switch_synth import (
        CEILING_DBFS,
        TIER1_PEAK_DBFS,
        TIER2_PEAK_DBFS,
        finalize,
        press_sound,
    )

AUDIO_ROOT = Path(__file__).resolve().parent

MAX_LEADING_SAMPLES = round(0.0015 * 48_000)  # max leading silence: 1.5 ms

# (relative dir, filename, recipe, expected duration ms, expected peak dBFS)
# Alphanumeric presses sit at Tier 1 (-12 dBFS); space/enter/backspace at
# Tier 2 (-9 dBFS). Both respect the -3 dBFS master ceiling.
SWITCH_MANIFEST: list[tuple[str, str, tuple[str, int], int, float]] = [
    *[
        ("switches/thock", f"press_{index}.wav", ("thock", index), 45, TIER1_PEAK_DBFS)
        for index in range(1, 5)
    ],
    ("switches/thock", "space.wav", ("thock", 0), 80, TIER2_PEAK_DBFS),
    ("switches/thock", "enter.wav", ("thock", 0), 70, TIER2_PEAK_DBFS),
    ("switches/thock", "backspace.wav", ("thock", 0), 40, TIER2_PEAK_DBFS),
    *[
        ("switches/clicky", f"press_{index}.wav", ("clicky", index), 50, TIER1_PEAK_DBFS)
        for index in range(1, 5)
    ],
    ("switches/clicky", "space.wav", ("clicky", 0), 90, TIER2_PEAK_DBFS),
    ("switches/clicky", "enter.wav", ("clicky", 0), 80, TIER2_PEAK_DBFS),
    ("switches/clicky", "backspace.wav", ("clicky", 0), 40, TIER2_PEAK_DBFS),
    *[
        ("switches/model-m", f"press_{index}.wav", ("model-m", index), 65, TIER1_PEAK_DBFS)
        for index in range(1, 4)
    ],
    ("switches/model-m", "space.wav", ("model-m", 0), 105, TIER2_PEAK_DBFS),
    ("switches/model-m", "enter.wav", ("model-m", 0), 90, TIER2_PEAK_DBFS),
    *[
        ("switches/synth", f"press_{index}.wav", ("synth", index), 32, TIER1_PEAK_DBFS)
        for index in range(1, 4)
    ],
    ("switches/synth", "space.wav", ("synth", 0), 62, TIER2_PEAK_DBFS),
]

DURATION_TOLERANCE_MS = 5.0
PEAK_TOLERANCE_DB = 0.25


def render_switch_sound(pack: str, variation: int, filename: str) -> list[float]:
    """Render a finalized signal for any manifest entry."""
    if variation > 0:
        return finalize(press_sound(pack, variation))
    from switch_synth import (
        thock_space,
        thock_enter,
        thock_backspace,
        clicky_space,
        clicky_enter,
        clicky_backspace,
        model_m_space,
        model_m_enter,
        synth_space,
    )

    specials = {
        ("thock", "space.wav"): thock_space,
        ("thock", "enter.wav"): thock_enter,
        ("thock", "backspace.wav"): thock_backspace,
        ("clicky", "space.wav"): clicky_space,
        ("clicky", "enter.wav"): clicky_enter,
        ("clicky", "backspace.wav"): clicky_backspace,
        ("model-m", "space.wav"): model_m_space,
        ("model-m", "enter.wav"): model_m_enter,
        ("synth", "space.wav"): synth_space,
    }
    factory = specials[(pack, filename)]
    return finalize(factory())


def generate_all(root: Path = AUDIO_ROOT) -> list[Path]:
    from dsp_synthesis import write_pcm_wav

    written: list[Path] = []
    for relative_dir, filename, (pack, variation), _expected_ms, _expected_peak in SWITCH_MANIFEST:
        output_dir = root / relative_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        signal = render_switch_sound(pack, variation, filename)
        output_path = output_dir / filename
        write_pcm_wav(output_path, signal)
        written.append(output_path)
    return written


def inspect_wav(path: Path) -> dict[str, object]:
    with wave.open(str(path), "rb") as audio_file:
        channels = audio_file.getnchannels()
        sample_width = audio_file.getsampwidth()
        sample_rate = audio_file.getframerate()
        frames = audio_file.getnframes()
        raw = audio_file.readframes(frames)

    total_samples = len(raw) // 2
    peak_linear = 0.0
    leading_silence: int | None = None
    for index in range(total_samples):
        sample = int.from_bytes(raw[2 * index : 2 * index + 2], "little", signed=True)
        magnitude = abs(sample) / 32767.0
        if magnitude > peak_linear:
            peak_linear = magnitude
        if leading_silence is None and magnitude > 0.001:
            leading_silence = index

    peak_dbfs = 20.0 * math.log10(peak_linear) if peak_linear > 0 else -math.inf
    return {
        "channels": channels,
        "sample_width": sample_width,
        "sample_rate": sample_rate,
        "frames": frames,
        "duration_ms": frames / 48.0,
        "peak_dbfs": peak_dbfs,
        "leading_silence_samples": leading_silence or 0,
    }


def validate_all(root: Path = AUDIO_ROOT) -> tuple[int, int, list[str]]:
    passed = 0
    total = 0
    failures: list[str] = []
    for relative_dir, filename, (_pack, _variation), expected_ms, expected_peak in SWITCH_MANIFEST:
        total += 1
        path = root / relative_dir / filename
        if not path.is_file():
            failures.append(f"{relative_dir}/{filename}: missing file")
            continue
        info = inspect_wav(path)
        errors: list[str] = []
        if info["channels"] != 1:
            errors.append(f"expected mono, got {info['channels']} channels")
        if info["sample_width"] != 2:
            errors.append(f"expected 16-bit PCM, got {info['sample_width'] * 8}-bit")
        if info["sample_rate"] != 48_000:
            errors.append(f"expected 48000 Hz, got {info['sample_rate']} Hz")
        if abs(info["duration_ms"] - expected_ms) > DURATION_TOLERANCE_MS:
            errors.append(
                f"duration {info['duration_ms']:.1f} ms outside {expected_ms} ±{DURATION_TOLERANCE_MS} ms"
            )
        if info["peak_dbfs"] > CEILING_DBFS:
            errors.append(f"peak {info['peak_dbfs']:.2f} dBFS exceeds the {CEILING_DBFS} dBFS ceiling")
        if abs(info["peak_dbfs"] - expected_peak) > PEAK_TOLERANCE_DB:
            errors.append(
                f"peak {info['peak_dbfs']:.2f} dBFS outside tier target {expected_peak:.1f} ±{PEAK_TOLERANCE_DB} dB"
            )
        if info["leading_silence_samples"] > MAX_LEADING_SAMPLES:
            errors.append(f"leading silence {info['leading_silence_samples']} samples exceeds 1.5 ms")
        if errors:
            failures.append(f"{relative_dir}/{filename}: " + "; ".join(errors))
        else:
            passed += 1
    return passed, total, failures


def print_report(root: Path = AUDIO_ROOT) -> int:
    passed, total, failures = validate_all(root)
    print("=" * 70)
    print("           TYPEKERNEL PHASE 2 SWITCH LIBRARY REPORT")
    print("=" * 70)
    print(f"Target Directory:  {root}")
    print(f"Total Required:    {len(SWITCH_MANIFEST)} files")
    print(f"Passed Validation: {passed} / {total}")
    if failures:
        print()
        print("Failures:")
        for failure in failures:
            print(f"  - {failure}")
    print("=" * 70)
    return 0 if passed == total else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Phase 2 switch packs")
    parser.add_argument(
        "--check",
        action="store_true",
        help="only validate existing WAV files without regenerating",
    )
    arguments = parser.parse_args()

    if not arguments.check:
        written = generate_all()
        print(f"Generated {len(written)} switch files under {AUDIO_ROOT}")
    return print_report()


if __name__ == "__main__":
    raise SystemExit(main())
