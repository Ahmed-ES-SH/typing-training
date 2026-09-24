"""Phase 4 generator: synthesize, master, and validate the 4 fanfare WAV files.

Usage:
    python3 generate_fanfares.py            # generate + validate + report
    python3 generate_fanfares.py --check    # validate existing files only
"""

from __future__ import annotations

import argparse
import math
import sys
import wave
from pathlib import Path

try:
    from fanfare_synth import (
        CEILING_DBFS,
        FANFARE_RECIPES,
        FanfareSound,
        GATE_PASS_DURATION,
        LEVEL_CLEARED_DURATION,
        PERSONAL_BEST_DURATION,
        RANK_UP_DURATION,
        TIER5_PEAK_DBFS,
        fanfare_finalize,
        fanfare_sound,
    )
except ImportError:
    from .fanfare_synth import (
        CEILING_DBFS,
        FANFARE_RECIPES,
        FanfareSound,
        GATE_PASS_DURATION,
        LEVEL_CLEARED_DURATION,
        PERSONAL_BEST_DURATION,
        RANK_UP_DURATION,
        TIER5_PEAK_DBFS,
        fanfare_finalize,
        fanfare_sound,
    )

AUDIO_ROOT = Path(__file__).resolve().parent

MAX_LEADING_SAMPLES = round(0.0015 * 48_000)  # max leading silence: 1.5 ms

# (filename, expected duration ms, expected peak dBFS)
# Fanfares render at Tier 5 (-3 dBFS), the loudest library layer, and stay
# at the master ceiling without ever exceeding it.
FANFARE_MANIFEST: list[tuple[str, int, float]] = [
    ("gate_pass.wav", 1500, TIER5_PEAK_DBFS),
    ("personal_best.wav", 1200, TIER5_PEAK_DBFS),
    ("level_cleared.wav", 2500, TIER5_PEAK_DBFS),
    ("rank_up.wav", 2000, TIER5_PEAK_DBFS),
]

DURATION_TOLERANCE_MS = 5.0
PEAK_TOLERANCE_DB = 0.25


def render_fanfare(filename: str) -> tuple[list[float], list[float]]:
    """Render a finalized (left, right) channel pair for a manifest entry."""
    return fanfare_finalize(fanfare_sound(filename))


def generate_all(root: Path = AUDIO_ROOT) -> list[Path]:
    from dsp_synthesis import write_pcm_wav

    written: list[Path] = []
    for filename, _expected_ms, _expected_peak in FANFARE_MANIFEST:
        output_dir = root / "fanfares"
        output_dir.mkdir(parents=True, exist_ok=True)
        left, right = render_fanfare(filename)
        output_path = output_dir / filename
        write_pcm_wav(output_path, [left, right])
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
    for filename, expected_ms, expected_peak in FANFARE_MANIFEST:
        total += 1
        path = root / "fanfares" / filename
        if not path.is_file():
            failures.append(f"fanfares/{filename}: missing file")
            continue
        info = inspect_wav(path)
        errors: list[str] = []
        if info["channels"] != 2:
            errors.append(f"expected stereo, got {info['channels']} channels")
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
            failures.append(f"fanfares/{filename}: " + "; ".join(errors))
        else:
            passed += 1
    return passed, total, failures


def print_report(root: Path = AUDIO_ROOT) -> int:
    passed, total, failures = validate_all(root)
    print("=" * 70)
    print("           TYPEKERNEL PHASE 4 MILESTONE FANFARE REPORT")
    print("=" * 70)
    print(f"Target Directory:  {root / 'fanfares'}")
    print(f"Total Required:    {len(FANFARE_MANIFEST)} files")
    print(f"Passed Validation: {passed} / {total}")
    if failures:
        print()
        print("Failures:")
        for failure in failures:
            print(f"  - {failure}")
    print("=" * 70)
    return 0 if passed == total else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Phase 4 fanfare pack")
    parser.add_argument(
        "--check",
        action="store_true",
        help="only validate existing WAV files without regenerating",
    )
    arguments = parser.parse_args()

    if not arguments.check:
        written = generate_all()
        print(f"Generated {len(written)} fanfare files under {AUDIO_ROOT / 'fanfares'}")
    return print_report()


if __name__ == "__main__":
    raise SystemExit(main())
