from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import wave
from pathlib import Path

try:
    from dsp_synthesis import (
        SAMPLE_RATE,
        EnvelopeSettings,
        adsr,
        apply_envelope,
        bandpass,
        bandpass_noise,
        damped_sine,
        frequency_sweep,
        highpass,
        karplus_strong,
        karplus_strong_bar,
        lowpass,
        mix,
        normalize_peak,
        pink_noise,
        remove_dc_offset,
        scale,
        sine,
        triangle,
        white_noise,
        write_pcm_wav,
    )
except ImportError:
    from .dsp_synthesis import (
        SAMPLE_RATE,
        EnvelopeSettings,
        adsr,
        apply_envelope,
        bandpass,
        bandpass_noise,
        damped_sine,
        frequency_sweep,
        highpass,
        karplus_strong,
        karplus_strong_bar,
        lowpass,
        mix,
        normalize_peak,
        pink_noise,
        remove_dc_offset,
        scale,
        sine,
        triangle,
        white_noise,
        write_pcm_wav,
    )

AUDIO_ROOT = Path(__file__).resolve().parent
REQUIRED_DIRECTORIES = (
    Path("switches/thock"),
    Path("switches/clicky"),
    Path("switches/model-m"),
    Path("switches/synth"),
    Path("sfx"),
    Path("fanfares"),
)


def ensure_directory_structure(root: Path = AUDIO_ROOT) -> None:
    root.mkdir(parents=True, exist_ok=True)
    for relative_directory in REQUIRED_DIRECTORIES:
        (root / relative_directory).mkdir(parents=True, exist_ok=True)


def missing_directories(root: Path = AUDIO_ROOT) -> list[Path]:
    return [
        relative_directory
        for relative_directory in REQUIRED_DIRECTORIES
        if not (root / relative_directory).is_dir()
    ]


SELF_TEST_DURATION = 0.02


def render_self_test_signals() -> tuple[list[float], ...]:
    envelope_settings = EnvelopeSettings(0.003, 0.005, 0.65, 0.012, "cubic")
    sine_signal = sine(SELF_TEST_DURATION, 440.0)
    white_signal = white_noise(SELF_TEST_DURATION, seed=1)
    pink_signal = pink_noise(SELF_TEST_DURATION, seed=2)
    chirp_signal = frequency_sweep(SELF_TEST_DURATION, 220.0, 880.0)
    modal_signal = damped_sine(SELF_TEST_DURATION, 130.0, 0.015)
    filtered = lowpass(white_signal, 1_000.0)
    shaped = apply_envelope(sine_signal, adsr(SELF_TEST_DURATION, envelope_settings))
    mixed = mix(shaped, scale(pink_signal, 0.3))
    normalized = normalize_peak(remove_dc_offset(mixed), target_dbfs=-3.0)

    return (
        sine_signal,
        triangle(SELF_TEST_DURATION, 440.0),
        white_signal,
        pink_signal,
        bandpass_noise(SELF_TEST_DURATION, 1_200.0, seed=7),
        karplus_strong(SELF_TEST_DURATION, 220.0, seed=8),
        karplus_strong_bar(SELF_TEST_DURATION, 330.0, seed=9),
        chirp_signal,
        modal_signal,
        filtered,
        normalized,
    )


def assert_wav_format(
    output_path: Path, expected_channels: int, expected_frames: int
) -> None:
    with wave.open(str(output_path), "rb") as audio_file:
        if audio_file.getnchannels() != expected_channels:
            raise RuntimeError("WAV channel self-test failed")
        if audio_file.getsampwidth() != 2:
            raise RuntimeError("WAV bit depth self-test failed")
        if audio_file.getframerate() != SAMPLE_RATE:
            raise RuntimeError("WAV sample rate self-test failed")
        if audio_file.getnframes() != expected_frames:
            raise RuntimeError("WAV frame count self-test failed")


def run_self_test(root: Path = AUDIO_ROOT) -> None:
    signals = render_self_test_signals()
    expected_frames = round(SELF_TEST_DURATION * SAMPLE_RATE)
    if any(len(signal) != expected_frames for signal in signals):
        raise RuntimeError("DSP generator length self-test failed")

    with tempfile.TemporaryDirectory(
        prefix=".phase1-", dir=root
    ) as temporary_directory:
        temporary_path = Path(temporary_directory)
        mono_path = temporary_path / "mono.wav"
        stereo_path = temporary_path / "stereo.wav"
        rendered_signal = signals[-1]
        write_pcm_wav(mono_path, rendered_signal)
        write_pcm_wav(stereo_path, [rendered_signal, rendered_signal])
        assert_wav_format(mono_path, 1, expected_frames)
        assert_wav_format(stereo_path, 2, expected_frames)

        ffmpeg_bin = shutil.which("ffmpeg")
        if ffmpeg_bin:
            import subprocess

            for test_file in (mono_path, stereo_path):
                result = subprocess.run(
                    [ffmpeg_bin, "-v", "error", "-i", str(test_file), "-f", "null", "-"],
                    capture_output=True,
                    text=True,
                )
                if result.returncode != 0:
                    raise RuntimeError(f"FFmpeg validation failed: {result.stderr}")



def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Set up the Phase 1 audio synthesis harness"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the directory scaffold and DSP harness after setup",
    )
    return parser


def print_runtime_report() -> None:
    ffmpeg_path = shutil.which("ffmpeg")
    print(f"Directories: {len(REQUIRED_DIRECTORIES)}/{len(REQUIRED_DIRECTORIES)} ready")
    print("DSP self-test: passed")
    print(f"Python: {sys.version.split()[0]}")
    print(f"FFmpeg: {ffmpeg_path or 'not found'}")


def run_phase_check() -> bool:
    missing = missing_directories()
    if missing:
        missing_paths = ", ".join(str(path) for path in missing)
        print(f"Missing required directories: {missing_paths}", file=sys.stderr)
        return False

    try:
        run_self_test()
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Phase 1 self-test failed: {error}", file=sys.stderr)
        return False

    print_runtime_report()
    return True


def main() -> int:
    arguments = build_parser().parse_args()
    ensure_directory_structure()
    if not arguments.check:
        print(f"Created Phase 1 audio scaffold at {AUDIO_ROOT}")
        return 0
    return 0 if run_phase_check() else 1


if __name__ == "__main__":
    raise SystemExit(main())
