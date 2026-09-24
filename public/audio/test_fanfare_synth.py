import math
import tempfile
import unittest
from pathlib import Path

from dsp_synthesis import peak, remove_dc_offset
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
    gate_pass,
    level_cleared,
    personal_best,
    rank_up,
)
from generate_fanfares import (
    FANFARE_MANIFEST,
    MAX_LEADING_SAMPLES,
    render_fanfare,
    validate_all,
)

EXPECTED_FANFARE_FILES = {
    "gate_pass.wav",
    "personal_best.wav",
    "level_cleared.wav",
    "rank_up.wav",
}

RECIPES = {
    "gate_pass.wav": (gate_pass, GATE_PASS_DURATION),
    "personal_best.wav": (personal_best, PERSONAL_BEST_DURATION),
    "level_cleared.wav": (level_cleared, LEVEL_CLEARED_DURATION),
    "rank_up.wav": (rank_up, RANK_UP_DURATION),
}


class TestRecipesReturnStereoFanfares(unittest.TestCase):
    def test_all_recipes_return_bounded_stereo_fanfares(self):
        for factory, duration in RECIPES.values():
            sound = factory()
            self.assertIsInstance(sound, FanfareSound)
            expected_frames = round(duration * 48_000)
            self.assertEqual(len(sound.left), expected_frames)
            self.assertEqual(len(sound.right), expected_frames)
            for channel in (sound.left, sound.right):
                self.assertTrue(all(math.isfinite(s) for s in channel))
                self.assertTrue(
                    all(abs(s) <= 4.0 for s in channel),
                    "raw mixtures must stay bounded",
                )

    def test_channels_are_decorrelated_for_stereo_width(self):
        # Stereo is a plan requirement; identical channels would mean the
        # widening pipeline silently collapsed into mono.
        for factory, _duration in RECIPES.values():
            sound = factory()
            self.assertNotEqual(sound.left, sound.right)

    def test_fanfare_sound_dispatch(self):
        self.assertIsInstance(fanfare_sound("gate_pass.wav"), FanfareSound)
        with self.assertRaises(ValueError):
            fanfare_sound("bogus.wav")

    def test_recipe_registry_covers_manifest(self):
        self.assertEqual(set(FANFARE_RECIPES), EXPECTED_FANFARE_FILES)

    def test_tier5_matches_master_ceiling(self):
        self.assertEqual(TIER5_PEAK_DBFS, -3.0)
        self.assertEqual(CEILING_DBFS, -3.0)


class TestDeterminism(unittest.TestCase):
    def test_same_inputs_same_output(self):
        for factory, _duration in RECIPES.values():
            first = fanfare_finalize(factory())
            second = fanfare_finalize(factory())
            self.assertEqual(first, second)

    def test_recipes_are_distinct(self):
        finalized = {
            name: fanfare_finalize(factory())
            for name, (factory, _duration) in RECIPES.items()
        }
        names = sorted(finalized)
        for index, name in enumerate(names):
            for other in names[index + 1 :]:
                self.assertNotEqual(finalized[name], finalized[other])


class TestFanfareFinalize(unittest.TestCase):
    def test_finalize_normalizes_joint_stereo_peak_to_tier5(self):
        for factory, _duration in RECIPES.values():
            left, right = fanfare_finalize(factory())
            joint_peak = max(peak(left), peak(right))
            self.assertAlmostEqual(joint_peak, 10 ** (TIER5_PEAK_DBFS / 20), places=4)

    def test_finalize_preserves_channel_balance(self):
        # Normalization is joint across channels; per-channel gain would
        # flatten the intended stereo placement. The balance is measured
        # on the DC-removed signals, matching finalize's pipeline order.
        sound = level_cleared()
        raw_ratio = peak(remove_dc_offset(sound.left)) / max(
            peak(remove_dc_offset(sound.right)), 1e-12
        )
        left, right = fanfare_finalize(sound)
        self.assertAlmostEqual(
            peak(left) / max(peak(right), 1e-12), raw_ratio, places=4
        )

    def test_finalize_has_no_trailing_click(self):
        left, right = fanfare_finalize(rank_up())
        for channel in (left, right):
            tail_peak = max(abs(s) for s in channel[-16:])
            full_peak = max(abs(s) for s in channel)
            self.assertLess(tail_peak, full_peak * 0.05)


class TestFanfaresHaveAudibleContent(unittest.TestCase):
    def test_signals_are_not_silent(self):
        for name, (factory, _duration) in RECIPES.items():
            for channel_index, channel in enumerate(fanfare_finalize(factory())):
                rms = math.sqrt(sum(s * s for s in channel) / len(channel))
                self.assertGreater(
                    rms, 0.005, f"{name} channel {channel_index} is silent"
                )

    def test_transients_start_within_five_milliseconds(self):
        # Plan: no leading silence; the first 1.5 ms must already move.
        for name, (factory, _duration) in RECIPES.items():
            left, right = fanfare_finalize(factory())
            head = max(
                max(abs(s) for s in left[MAX_LEADING_SAMPLES : round(0.005 * 48_000)]),
                max(abs(s) for s in right[MAX_LEADING_SAMPLES : round(0.005 * 48_000)]),
            )
            self.assertGreater(head, 0.01, f"{name} opens with silence")


class TestGeneratedFiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.generated = render_fanfare("gate_pass.wav")

    def test_manifest_matches_plan(self):
        expected = {
            "gate_pass.wav": (1500, TIER5_PEAK_DBFS),
            "personal_best.wav": (1200, TIER5_PEAK_DBFS),
            "level_cleared.wav": (2500, TIER5_PEAK_DBFS),
            "rank_up.wav": (2000, TIER5_PEAK_DBFS),
        }
        actual = {filename: (ms, tier) for filename, ms, tier in FANFARE_MANIFEST}
        self.assertEqual(actual, expected)

    def test_rendered_channels_are_finalized_stereo_pair(self):
        left, right = self.generated
        expected_peak = 10 ** (TIER5_PEAK_DBFS / 20)
        self.assertAlmostEqual(max(peak(left), peak(right)), expected_peak, places=4)
        self.assertEqual(len(left), len(right))

    def test_validate_all_runs(self):
        # validate_all against a temp dir with no files reports all missing.
        with tempfile.TemporaryDirectory() as temp_dir:
            passed, total, failures = validate_all(Path(temp_dir))
            self.assertEqual(total, 4)
            self.assertEqual(passed, 0)
            self.assertEqual(len(failures), 4)


if __name__ == "__main__":
    unittest.main()
