import math
import tempfile
import unittest
from pathlib import Path

from dsp_synthesis import peak
from generate_sfx import (
    SFX_MANIFEST,
    inspect_wav,
    render_sfx,
    validate_all,
)
from sfx_synth import (
    CEILING_DBFS,
    SFX_ERROR_DURATION,
    SFX_OVERDRIVE_DURATION,
    SFX_RECIPES,
    SFX_TICK_DURATION,
    MIN_AUDIBLE_RMS,
    SfxSound,
    TIER3_PEAK_DBFS,
    TIER4_PEAK_DBFS,
    combo_blaze_25,
    combo_breaker,
    combo_inferno_50,
    combo_overdrive_100,
    combo_spark_10,
    countdown_tick,
    error_knock,
    sfx_finalize,
    sfx_sound,
    streak_flame,
)

EXPECTED_SFX_FILES = {
    "error_knock.wav",
    "countdown_tick.wav",
    "combo_spark_10.wav",
    "combo_blaze_25.wav",
    "combo_inferno_50.wav",
    "combo_overdrive_100.wav",
    "combo_breaker.wav",
    "streak_flame.wav",
}


class TestRecipesReturnSfxSounds(unittest.TestCase):
    def test_all_recipes_return_sfx_sound(self):
        recipes = [
            error_knock(),
            countdown_tick(),
            combo_spark_10(),
            combo_blaze_25(),
            combo_inferno_50(),
            combo_overdrive_100(),
            combo_breaker(),
            streak_flame(),
        ]
        for recipe in recipes:
            self.assertIsInstance(recipe, SfxSound, "recipes are pre-normalization mixtures")
            self.assertTrue(all(math.isfinite(s) for s in recipe.signal))
            self.assertTrue(
                all(abs(s) <= 4.0 for s in recipe.signal),
                "raw mixtures must stay bounded",
            )

    def test_sfx_sound_dispatch(self):
        self.assertIsInstance(sfx_sound("error_knock.wav"), SfxSound)
        with self.assertRaises(ValueError):
            sfx_sound("bogus.wav")

    def test_recipe_registry_covers_manifest(self):
        self.assertEqual(set(SFX_RECIPES), EXPECTED_SFX_FILES)

    def test_tier_levels(self):
        self.assertEqual(TIER3_PEAK_DBFS, -6.0)
        self.assertEqual(TIER4_PEAK_DBFS, -4.0)
        self.assertEqual(CEILING_DBFS, -3.0)
        self.assertGreater(TIER4_PEAK_DBFS, TIER3_PEAK_DBFS)

    def test_durations_match_manifest(self):
        # Recipe durations must sit inside each plan window; the manifest
        # encodes the target durations the validator checks against.
        expected_durations = {
            "error_knock.wav": SFX_ERROR_DURATION,
            "countdown_tick.wav": SFX_TICK_DURATION,
            "combo_overdrive_100.wav": SFX_OVERDRIVE_DURATION,
        }
        for filename, recipe in SFX_RECIPES.items():
            if filename in expected_durations:
                self.assertEqual(
                    len(recipe().signal),
                    round(expected_durations[filename] * 48_000),
                )
            else:
                self.assertGreater(len(recipe().signal), 0)


class TestDeterminism(unittest.TestCase):
    def test_same_inputs_same_output(self):
        first = sfx_finalize(error_knock())
        second = sfx_finalize(error_knock())
        self.assertEqual(first, second)

    def test_recipes_are_distinct(self):
        finalized = {name: sfx_finalize(factory()) for name, factory in SFX_RECIPES.items()}
        names = sorted(finalized)
        for index, name in enumerate(names):
            for other in names[index + 1 :]:
                self.assertNotEqual(finalized[name], finalized[other])


class TestSfxFinalize(unittest.TestCase):
    def test_tier_normalization(self):
        finalized = sfx_finalize(combo_spark_10())
        expected = 10 ** (TIER3_PEAK_DBFS / 20)
        self.assertAlmostEqual(peak(finalized), expected, places=4)

    def test_overdrive_tier_normalization(self):
        finalized = sfx_finalize(combo_overdrive_100())
        expected = 10 ** (TIER4_PEAK_DBFS / 20)
        self.assertAlmostEqual(peak(finalized), expected, places=4)

    def test_overdrive_is_louder_than_spark(self):
        spark_peak = peak(sfx_finalize(combo_spark_10()))
        overdrive_peak = peak(sfx_finalize(combo_overdrive_100()))
        self.assertGreater(overdrive_peak, spark_peak)

    def test_no_trailing_click(self):
        finalized = sfx_finalize(countdown_tick())
        tail_peak = max(abs(s) for s in finalized[-16:])
        full_peak = max(abs(s) for s in finalized)
        self.assertLess(tail_peak, full_peak * 0.05)


class TestSfxSoundsHaveAudibleContent(unittest.TestCase):
    def test_signals_are_not_silent(self):
        for name, factory in SFX_RECIPES.items():
            signal = sfx_finalize(factory())
            rms = math.sqrt(sum(s * s for s in signal) / len(signal))
            self.assertGreater(rms, MIN_AUDIBLE_RMS, f"{name} is silent")


class TestErrorKnockCharacter(unittest.TestCase):
    def test_error_knock_is_not_a_buzzer(self):
        # The plan forbids harsh buzzer tones: the knock must be a muted,
        # decaying modal hit, i.e. its tail must decay well below its peak.
        signal = sfx_finalize(error_knock())
        head_peak = max(abs(s) for s in signal[: round(0.005 * 48_000)])
        tail_peak = max(abs(s) for s in signal[round(0.030 * 48_000) :])
        self.assertGreater(head_peak, tail_peak * 4.0)


class TestGeneratedFiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.generated = render_sfx("combo_spark_10.wav")

    def test_manifest_has_8_entries(self):
        self.assertEqual(len(SFX_MANIFEST), 8)

    def test_manifest_matches_plan(self):
        expected = {
            "error_knock.wav": (40, TIER3_PEAK_DBFS),
            "countdown_tick.wav": (35, TIER3_PEAK_DBFS),
            "combo_spark_10.wav": (120, TIER3_PEAK_DBFS),
            "combo_blaze_25.wav": (200, TIER3_PEAK_DBFS),
            "combo_inferno_50.wav": (400, TIER3_PEAK_DBFS),
            "combo_overdrive_100.wav": (650, TIER4_PEAK_DBFS),
            "combo_breaker.wav": (200, TIER3_PEAK_DBFS),
            "streak_flame.wav": (300, TIER3_PEAK_DBFS),
        }
        actual = {filename: (ms, tier) for filename, ms, tier in SFX_MANIFEST}
        self.assertEqual(actual, expected)

    def test_rendered_signal_is_finalized(self):
        expected_peak = 10 ** (TIER3_PEAK_DBFS / 20)
        self.assertAlmostEqual(peak(self.generated), expected_peak, places=4)

    def test_validate_all_runs(self):
        # validate_all against a temp dir with no files reports all missing.
        with tempfile.TemporaryDirectory() as temp_dir:
            passed, total, failures = validate_all(Path(temp_dir))
            self.assertEqual(total, 8)
            self.assertEqual(passed, 0)
            self.assertEqual(len(failures), 8)


if __name__ == "__main__":
    unittest.main()
