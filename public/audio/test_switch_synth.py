import math
import unittest

from dsp_synthesis import peak
from switch_synth import (
    CEILING_DBFS,
    SwitchSound,
    TIER1_PEAK_DBFS,
    TIER2_PEAK_DBFS,
    clicky_backspace,
    clicky_enter,
    clicky_press,
    clicky_space,
    finalize,
    model_m_enter,
    model_m_press,
    model_m_space,
    press_sound,
    synth_press,
    synth_space,
    thock_backspace,
    thock_enter,
    thock_press,
    thock_space,
)
from generate_switches import (
    SWITCH_MANIFEST,
    inspect_wav,
    render_switch_sound,
    validate_all,
)


class TestRecipesReturnSwitchSounds(unittest.TestCase):
    def test_all_recipes_return_switch_sound(self):
        recipes = [
            thock_press(1),
            thock_press(2),
            thock_press(3),
            thock_press(4),
            thock_space(),
            thock_enter(),
            thock_backspace(),
            clicky_press(1),
            clicky_press(2),
            clicky_press(3),
            clicky_press(4),
            clicky_space(),
            clicky_enter(),
            clicky_backspace(),
            model_m_press(1),
            model_m_press(2),
            model_m_press(3),
            model_m_space(),
            model_m_enter(),
            synth_press(1),
            synth_press(2),
            synth_press(3),
            synth_space(),
        ]
        for recipe in recipes:
            self.assertIsInstance(recipe, SwitchSound, "recipes are pre-normalization mixtures")
            self.assertTrue(all(math.isfinite(s) for s in recipe.signal))
            self.assertTrue(
                all(abs(s) <= 4.0 for s in recipe.signal),
                "raw mixtures must stay bounded",
            )

    def test_press_sound_dispatch(self):
        self.assertIsInstance(press_sound("thock", 2), SwitchSound)
        with self.assertRaises(ValueError):
            press_sound("bogus", 1)

    def test_tier_levels(self):
        self.assertEqual(TIER1_PEAK_DBFS, -12.0)
        self.assertEqual(TIER2_PEAK_DBFS, -9.0)
        self.assertEqual(CEILING_DBFS, -3.0)
        self.assertGreater(TIER2_PEAK_DBFS, TIER1_PEAK_DBFS)


class TestDeterminism(unittest.TestCase):
    def test_same_inputs_same_output(self):
        first = finalize(thock_press(1))
        second = finalize(thock_press(1))
        self.assertEqual(first, second)

    def test_variations_are_distinct(self):
        signals = [finalize(thock_press(i)) for i in range(1, 5)]
        for i, signal in enumerate(signals):
            for other in signals[i + 1 :]:
                self.assertNotEqual(signal, other)


class TestFinalize(unittest.TestCase):
    def test_tier_normalization(self):
        raw = thock_press(1)
        finalized = finalize(raw)
        peak_value = peak(finalized)
        expected = 10 ** (TIER1_PEAK_DBFS / 20)
        self.assertAlmostEqual(peak_value, expected, places=4)

    def test_space_tier_is_louder_than_press(self):
        press_peak = peak(finalize(thock_press(1)))
        space_peak = peak(finalize(thock_space()))
        self.assertGreater(space_peak, press_peak)

    def test_no_trailing_click(self):
        # Fade-out ensures the tail ends near silence.
        finalized = finalize(clicky_press(1))
        tail_peak = max(abs(s) for s in finalized[-16:])
        full_peak = max(abs(s) for s in finalized)
        self.assertLess(tail_peak, full_peak * 0.05)


class TestSwitchSoundsHaveAudibleContent(unittest.TestCase):
    def test_signals_are_not_silent(self):
        names = [
            ("thock", 1),
            ("thock", 2),
            ("thock", 3),
            ("thock", 4),
            ("clicky", 1),
            ("clicky", 2),
            ("clicky", 3),
            ("clicky", 4),
            ("model-m", 1),
            ("model-m", 2),
            ("model-m", 3),
            ("synth", 1),
            ("synth", 2),
            ("synth", 3),
        ]
        for pack, variation in names:
            signal = finalize(press_sound(pack, variation))
            rms = math.sqrt(sum(s * s for s in signal) / len(signal))
            self.assertGreater(rms, 0.005, f"{pack} press {variation} is silent")


class TestGeneratedFiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.generated = render_switch_sound("thock", 1, "press_1.wav")

    def test_manifest_has_23_entries(self):
        self.assertEqual(len(SWITCH_MANIFEST), 23)

    def test_manifest_matches_plan(self):
        expected = {
            "switches/thock": ["press_1.wav", "press_2.wav", "press_3.wav", "press_4.wav", "space.wav", "enter.wav", "backspace.wav"],
            "switches/clicky": ["press_1.wav", "press_2.wav", "press_3.wav", "press_4.wav", "space.wav", "enter.wav", "backspace.wav"],
            "switches/model-m": ["press_1.wav", "press_2.wav", "press_3.wav", "space.wav", "enter.wav"],
            "switches/synth": ["press_1.wav", "press_2.wav", "press_3.wav", "space.wav"],
        }
        actual = {}
        for relative_dir, filename, _recipe, _ms, _peak in SWITCH_MANIFEST:
            actual.setdefault(relative_dir, []).append(filename)
        self.assertEqual(actual, expected)

    def test_rendered_signal_is_finalized(self):
        expected_peak = 10 ** (TIER1_PEAK_DBFS / 20)
        self.assertAlmostEqual(peak(self.generated), expected_peak, places=4)

    def test_validate_all_runs(self):
        # validate_all against a temp dir with no files should report all missing.
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as temp_dir:
            passed, total, failures = validate_all(Path(temp_dir))
            self.assertEqual(total, 23)
            self.assertEqual(passed, 0)
            self.assertEqual(len(failures), 23)


if __name__ == "__main__":
    unittest.main()
