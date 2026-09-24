import math
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path

from dsp_synthesis import (
    SAMPLE_RATE,
    EnvelopeSettings,
    adsr,
    apply_biquad,
    apply_envelope,
    bandpass,
    bandpass_noise,
    damped_sine,
    db_to_linear,
    frequency_sweep,
    highpass,
    karplus_strong,
    karplus_strong_bar,
    lowpass,
    mix,
    normalize_peak,
    peak,
    pink_noise,
    remove_dc_offset,
    scale,
    sine,
    triangle,
    white_noise,
    write_pcm_wav,
)
from harness import REQUIRED_DIRECTORIES, missing_directories


class TestDirectoryStructure(unittest.TestCase):
    def test_required_directories_exist(self):
        missing = missing_directories()
        self.assertEqual(missing, [], f"Missing required directories: {missing}")

    def test_directory_count(self):
        self.assertEqual(len(REQUIRED_DIRECTORIES), 6)


class TestWaveformGenerators(unittest.TestCase):
    def test_sine(self):
        duration = 0.05
        samples = sine(duration, 440.0, amplitude=0.8)
        expected_len = round(duration * SAMPLE_RATE)
        self.assertEqual(len(samples), expected_len)
        self.assertAlmostEqual(peak(samples), 0.8, places=2)
        with self.assertRaises(ValueError):
            sine(duration, 0.0)
        with self.assertRaises(ValueError):
            sine(duration, SAMPLE_RATE / 2)

    def test_triangle(self):
        duration = 0.05
        samples = triangle(duration, 440.0, amplitude=1.0)
        self.assertEqual(len(samples), round(duration * SAMPLE_RATE))
        self.assertTrue(all(-1.0 <= s <= 1.0 for s in samples))

    def test_white_noise(self):
        samples1 = white_noise(0.02, seed=42)
        samples2 = white_noise(0.02, seed=42)
        samples3 = white_noise(0.02, seed=99)
        self.assertEqual(samples1, samples2)
        self.assertNotEqual(samples1, samples3)
        self.assertTrue(all(-1.0 <= s <= 1.0 for s in samples1))

    def test_pink_noise(self):
        samples = pink_noise(0.05, amplitude=0.9, seed=123)
        self.assertEqual(len(samples), round(0.05 * SAMPLE_RATE))
        self.assertAlmostEqual(peak(samples), 0.9, places=2)
        self.assertTrue(all(math.isfinite(s) for s in samples))

    def test_frequency_sweep(self):
        linear_sweep = frequency_sweep(0.05, 200.0, 800.0, method="linear")
        exp_sweep = frequency_sweep(0.05, 200.0, 800.0, method="exponential")
        self.assertEqual(len(linear_sweep), round(0.05 * SAMPLE_RATE))
        self.assertEqual(len(exp_sweep), round(0.05 * SAMPLE_RATE))
        self.assertTrue(all(-1.0 <= s <= 1.0 for s in linear_sweep))
        self.assertTrue(all(-1.0 <= s <= 1.0 for s in exp_sweep))
        with self.assertRaises(ValueError):
            frequency_sweep(0.05, 200.0, 800.0, method="invalid")

    def test_damped_sine(self):
        duration = 0.04
        samples = damped_sine(duration, 200.0, decay_time=0.01)
        self.assertEqual(len(samples), round(duration * SAMPLE_RATE))
        self.assertGreater(peak(samples[:200]), peak(samples[-200:]) * 5)

    def test_karplus_strong_and_bar(self):
        duration = 0.05
        string_sig = karplus_strong(duration, 440.0, seed=1)
        bar_sig = karplus_strong_bar(duration, 440.0, stiffness=0.4, seed=1)
        self.assertEqual(len(string_sig), round(duration * SAMPLE_RATE))
        self.assertEqual(len(bar_sig), round(duration * SAMPLE_RATE))
        self.assertNotEqual(string_sig, bar_sig)
        self.assertTrue(all(math.isfinite(s) for s in string_sig))
        self.assertTrue(all(math.isfinite(s) for s in bar_sig))


class TestFilters(unittest.TestCase):
    def test_biquad_filters(self):
        sig_low = sine(0.05, 100.0)
        sig_high = sine(0.05, 4000.0)

        # Lowpass filter at 300Hz: passes 100Hz, attenuates 4000Hz
        lp_low = lowpass(sig_low, 300.0)
        lp_high = lowpass(sig_high, 300.0)
        self.assertGreater(peak(lp_low), 0.8)
        self.assertLess(peak(lp_high), 0.1)

        # Highpass filter at 1000Hz: attenuates 100Hz, passes 4000Hz
        hp_low = highpass(sig_low, 1000.0)
        hp_high = highpass(sig_high, 1000.0)
        self.assertLess(peak(hp_low), 0.1)
        self.assertGreater(peak(hp_high), 0.8)

        # Bandpass filter at 1000Hz: attenuates 100Hz and 4000Hz
        bp_low = bandpass(sig_low, 1000.0, q=2.0)
        bp_high = bandpass(sig_high, 1000.0, q=2.0)
        self.assertLess(peak(bp_low), 0.15)
        self.assertLess(peak(bp_high), 0.25)


class TestEnvelopes(unittest.TestCase):
    def test_adsr_curves(self):
        duration = 0.05
        settings_exp = EnvelopeSettings(0.005, 0.010, 0.5, 0.015, curve="exponential")
        env_exp = adsr(duration, settings_exp)
        self.assertEqual(len(env_exp), round(duration * SAMPLE_RATE))
        self.assertAlmostEqual(env_exp[0], 0.0, places=3)
        self.assertAlmostEqual(env_exp[-1], 0.0, places=2)

        settings_cubic = EnvelopeSettings(0.005, 0.010, 0.5, 0.015, curve="cubic")
        env_cubic = adsr(duration, settings_cubic)
        self.assertEqual(len(env_cubic), round(duration * SAMPLE_RATE))
        self.assertAlmostEqual(env_cubic[0], 0.0, places=3)
        self.assertAlmostEqual(env_cubic[-1], 0.0, places=2)

    def test_apply_envelope(self):
        sig = [1.0] * 100
        env = [0.5] * 100
        result = apply_envelope(sig, env)
        self.assertEqual(result, [0.5] * 100)


class TestSignalProcessingAndWavOutput(unittest.TestCase):
    def test_mix_scale_normalize(self):
        sig1 = [0.2, 0.4]
        sig2 = [0.1, -0.2]
        mixed = mix(sig1, sig2)
        self.assertAlmostEqual(mixed[0], 0.3)
        self.assertAlmostEqual(mixed[1], 0.2)

        scaled = scale(mixed, 2.0)
        self.assertAlmostEqual(scaled[0], 0.6)
        self.assertAlmostEqual(scaled[1], 0.4)

        # DC offset removal
        offset_sig = [1.0, 2.0, 3.0]
        no_dc = remove_dc_offset(offset_sig)
        self.assertAlmostEqual(sum(no_dc), 0.0)

        # Peak normalization to -3 dBFS (~0.7079)
        norm = normalize_peak([0.2, -0.5], target_dbfs=-3.0)
        self.assertAlmostEqual(peak(norm), db_to_linear(-3.0), places=3)

    def test_write_pcm_wav_mono_and_stereo(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            mono_path = Path(temp_dir) / "mono.wav"
            stereo_path = Path(temp_dir) / "stereo.wav"

            sig = sine(0.04, 440.0, amplitude=0.7)
            write_pcm_wav(mono_path, sig)
            write_pcm_wav(stereo_path, [sig, sig])

            # Validate mono WAV header
            with wave.open(str(mono_path), "rb") as wf:
                self.assertEqual(wf.getnchannels(), 1)
                self.assertEqual(wf.getsampwidth(), 2)  # 16-bit
                self.assertEqual(wf.getframerate(), 48000)
                self.assertEqual(wf.getnframes(), round(0.04 * 48000))

            # Validate stereo WAV header
            with wave.open(str(stereo_path), "rb") as wf:
                self.assertEqual(wf.getnchannels(), 2)
                self.assertEqual(wf.getsampwidth(), 2)  # 16-bit
                self.assertEqual(wf.getframerate(), 48000)
                self.assertEqual(wf.getnframes(), round(0.04 * 48000))

            # Validate via ffmpeg if available
            ffmpeg = shutil.which("ffmpeg")
            if ffmpeg:
                for target in (mono_path, stereo_path):
                    res = subprocess.run(
                        [ffmpeg, "-v", "error", "-i", str(target), "-f", "null", "-"],
                        capture_output=True,
                        text=True,
                    )
                    self.assertEqual(res.returncode, 0, f"FFmpeg failed: {res.stderr}")


if __name__ == "__main__":
    unittest.main()
