"""Layered DSP recipes for the Phase 3 SFX and combo feedback cues.

Every recipe returns an :class:`SfxSound` holding a raw float signal plus
the tier peak level it must be normalized to, mirroring :mod:`switch_synth`.
All recipes are deterministic, so generation can be re-run reproducibly.
Use :func:`sfx_finalize` to apply the fade-out, DC removal, and tier
normalization before writing a WAV file.

Loudness hierarchy (plan section 3.2):
- Tier 3 (-6 dBFS): error knock, countdown tick, combo chimes/whooshes,
  combo breaker, streak flame.
- Tier 4 (-4 dBFS): the rare x100 overdrive adrenaline peak.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from dsp_synthesis import (
    EnvelopeSettings,
    adsr,
    apply_envelope,
    bandpass_noise,
    damped_sine,
    frequency_sweep,
    highpass,
    lowpass,
    mix,
    normalize_peak,
    pink_noise,
    remove_dc_offset,
    scale,
    white_noise,
)
from switch_synth import (
    _click_bar,
    _delay,
    _fast_decay_tail,
    _pad_to_length,
    _seconds_to_samples,
    _thock_body,
)

TIER3_PEAK_DBFS = -6.0  # error knock, countdown, combos, breaker, streak
TIER4_PEAK_DBFS = -4.0  # rare x100 overdrive adrenaline peak
CEILING_DBFS = -3.0  # absolute master ceiling (inherited from the plan)

SFX_ERROR_DURATION = 0.040  # 40 ms knock (30-50 ms window)
SFX_TICK_DURATION = 0.035  # 35 ms tick (30-50 ms window)
SFX_SPARK_DURATION = 0.120  # 120 ms chime (100-150 ms window)
SFX_BLAZE_DURATION = 0.200  # 200 ms chime (150-250 ms window)
SFX_INFERNO_DURATION = 0.400  # 400 ms whoosh (300-500 ms window)
SFX_OVERDRIVE_DURATION = 0.650  # 650 ms bass drop (500-800 ms window)
SFX_BREAKER_DURATION = 0.200  # 200 ms fizzle (150-250 ms window)
SFX_STREAK_DURATION = 0.300  # 300 ms whoosh (200-400 ms window)

TRAILING_FADE_MS = 3.0
MIN_AUDIBLE_RMS = 0.005

ERROR_KNOCK = "error_knock.wav"
COUNTDOWN_TICK = "countdown_tick.wav"
COMBO_SPARK_10 = "combo_spark_10.wav"
COMBO_BLAZE_25 = "combo_blaze_25.wav"
COMBO_INFERNO_50 = "combo_inferno_50.wav"
COMBO_OVERDRIVE_100 = "combo_overdrive_100.wav"
COMBO_BREAKER = "combo_breaker.wav"
STREAK_FLAME = "streak_flame.wav"

# A bright major-pentatonic bell set keeps every combo cue musical.
SPARK_FREQUENCY = 659.26  # E5
BLAZE_HIGH_FREQUENCY = 987.77  # B5
INFERNO_MOTIF_FREQUENCIES = (659.26, 830.61, 987.77)  # E5 - G#5 - B5
OVERDRIVE_CHIME_FREQUENCY = 1318.51  # E6


@dataclass(frozen=True)
class SfxSound:
    """A raw SFX signal plus the peak level it must be normalized to."""

    signal: list[float]
    tier_peak_dbfs: float


def sfx_finalize(sound: SfxSound) -> list[float]:
    """Apply DC removal, trailing fade-out, and tier peak normalization."""
    signal = remove_dc_offset(sound.signal)
    fade_samples = _seconds_to_samples(TRAILING_FADE_MS / 1000.0)
    fade_start = max(0, len(signal) - fade_samples)
    faded: list[float] = []
    for index, sample in enumerate(signal):
        if index >= fade_start:
            remaining = (len(signal) - index) / max(1, len(signal) - fade_start)
            sample *= remaining
        faded.append(sample)
    return normalize_peak(faded, target_dbfs=sound.tier_peak_dbfs)


# ---------------------------------------------------------------------------
# Step 3.1 — Error knock & countdown tick
# ---------------------------------------------------------------------------


def error_knock() -> SfxSound:
    """Non-punitive hollow wood knock: 130 Hz fundamental + 260 Hz overtone.

    Purely modal (no square/saw buzz) so the error cue reads as a muted,
    organic tap rather than a punishing alarm.
    """
    duration = SFX_ERROR_DURATION
    fundamental = damped_sine(duration, 130.0, decay_time=0.018, amplitude=0.85)
    overtone = damped_sine(duration, 260.0, decay_time=0.012, amplitude=0.40, phase=0.6)
    body = _thock_body(duration, detune=0.0, amplitude=0.35, decay_scale=0.75)
    grain = scale(
        _fast_decay_tail(0.006, bandpass_noise(0.010, 1_250.0, q=1.5, seed=2_001)),
        0.18,
    )
    signal = mix(
        fundamental,
        overtone,
        _pad_to_length(body, len(fundamental)),
        _pad_to_length(grain, len(fundamental)),
    )
    return SfxSound(signal=signal, tier_peak_dbfs=TIER3_PEAK_DBFS)


def countdown_tick() -> SfxSound:
    """Clean high-tech precision tick: 1.8 kHz snap + 2.6 kHz overtone ring."""
    duration = SFX_TICK_DURATION
    snap = _click_bar(0.008, 1_800.0, seed=2_101, amplitude=0.90)
    overtone = damped_sine(duration, 2_600.0, decay_time=0.008, amplitude=0.30, phase=0.4)
    settle = damped_sine(duration, 520.0, decay_time=0.010, amplitude=0.22)
    signal = mix(
        _pad_to_length(snap, len(overtone)),
        overtone,
        settle,
    )
    return SfxSound(signal=signal, tier_peak_dbfs=TIER3_PEAK_DBFS)


# ---------------------------------------------------------------------------
# Bell partial helper for the musical combo tiers
# ---------------------------------------------------------------------------


def _bell_voice(
    duration: float,
    frequency: float,
    start_seconds: float,
    decay_time: float,
    amplitude: float = 1.0,
    strike_seed: int = 0,
) -> list[float]:
    """A struck-bell voice: tuned partials plus a filtered strike transient.

    Harmonic-leaning partials (no inharmonic harshness) so stacked combo
    chimes stay musical and non-annoying over long sessions.
    """
    partials = mix(
        damped_sine(duration, frequency, decay_time=decay_time, amplitude=0.62),
        damped_sine(
            duration,
            frequency * 2.0,
            decay_time=decay_time * 0.55,
            amplitude=0.28,
            phase=0.5,
        ),
        damped_sine(
            duration,
            frequency * 3.0,
            decay_time=decay_time * 0.35,
            amplitude=0.14,
            phase=1.1,
        ),
        damped_sine(
            duration,
            frequency * 4.2,
            decay_time=decay_time * 0.22,
            amplitude=0.08,
            phase=1.7,
        ),
    )
    strike = _click_bar(0.006, frequency * 6.0, seed=strike_seed, amplitude=0.10)
    voiced = mix(partials, _pad_to_length(strike, len(partials)))
    envelope = adsr(
        duration,
        EnvelopeSettings(0.002, duration * 0.9, 0.0, 0.0, "exponential"),
    )
    voiced = apply_envelope(voiced, envelope)
    return _delay(voiced, start_seconds)


def _combo_body_pad(duration: float) -> list[float]:
    """Soft filtered-noise bed under a combo cue so it doesn't feel bare."""
    bed = lowpass(pink_noise(duration, seed=3_001), 900.0)
    swell = adsr(
        duration,
        EnvelopeSettings(
            duration * 0.25, duration * 0.35, 0.55, duration * 0.28, "cubic"
        ),
    )
    return scale(apply_envelope(bed, swell), 0.08)


# ---------------------------------------------------------------------------
# Step 3.2 — Combo tiers
# ---------------------------------------------------------------------------


def combo_spark_10() -> SfxSound:
    """Gentle bright single bell chime (E5, 120 ms)."""
    duration = SFX_SPARK_DURATION
    total_samples = _seconds_to_samples(duration)
    bell = _bell_voice(
        duration,
        SPARK_FREQUENCY,
        start_seconds=0.0,
        decay_time=0.075,
        amplitude=0.95,
        strike_seed=3_101,
    )
    shimmer = scale(
        _fast_decay_tail(0.030, bandpass_noise(0.045, 5_200.0, q=5.0, seed=3_102)),
        0.06,
    )
    signal = mix(
        _pad_to_length(bell, total_samples),
        _pad_to_length(shimmer, total_samples),
        _combo_body_pad(duration),
    )
    return SfxSound(signal=signal, tier_peak_dbfs=TIER3_PEAK_DBFS)


def combo_blaze_25() -> SfxSound:
    """Ascending dual-tone chime (E5 -> B5, 200 ms)."""
    duration = SFX_BLAZE_DURATION
    total_samples = _seconds_to_samples(duration)
    first = _bell_voice(
        duration,
        SPARK_FREQUENCY,
        start_seconds=0.0,
        decay_time=0.080,
        amplitude=0.90,
        strike_seed=3_201,
    )
    second = _bell_voice(
        duration,
        BLAZE_HIGH_FREQUENCY,
        start_seconds=0.070,
        decay_time=0.075,
        amplitude=0.85,
        strike_seed=3_202,
    )
    signal = mix(
        _pad_to_length(first, total_samples),
        _pad_to_length(second, total_samples),
        _combo_body_pad(duration),
    )
    return SfxSound(signal=signal, tier_peak_dbfs=TIER3_PEAK_DBFS)


def combo_inferno_50() -> SfxSound:
    """Rising energetic synth whoosh under an ascending three-note motif."""
    duration = SFX_INFERNO_DURATION
    total_samples = _seconds_to_samples(duration)
    motif = mix(
        *(
            _bell_voice(
                duration,
                frequency,
                start_seconds=0.10 * index,
                decay_time=0.070,
                amplitude=0.72 - 0.06 * index,
                strike_seed=3_301 + index,
            )
            for index, frequency in enumerate(INFERNO_MOTIF_FREQUENCIES)
        )
    )
    riser = frequency_sweep(duration, 180.0, 720.0, amplitude=0.30, method="exponential")
    riser = lowpass(riser, 2_400.0, q=1.6)
    riser_env = adsr(
        duration,
        EnvelopeSettings(duration * 0.55, duration * 0.10, 0.85, duration * 0.25, "cubic"),
    )
    riser = apply_envelope(riser, riser_env)
    air = scale(highpass(white_noise(duration, seed=3_309), 3_500.0), 0.05)
    air_env = adsr(
        duration,
        EnvelopeSettings(duration * 0.6, duration * 0.1, 0.8, duration * 0.2, "cubic"),
    )
    air = apply_envelope(air, air_env)
    signal = mix(
        _pad_to_length(motif, total_samples),
        _pad_to_length(riser, total_samples),
        _pad_to_length(air, total_samples),
        _combo_body_pad(duration),
    )
    return SfxSound(signal=signal, tier_peak_dbfs=TIER3_PEAK_DBFS)


def combo_overdrive_100() -> SfxSound:
    """Deep sub-bass drop plus an electric surge (x100 adrenaline peak)."""
    duration = SFX_OVERDRIVE_DURATION
    total_samples = _seconds_to_samples(duration)

    drop_duration = 0.30
    drop = frequency_sweep(
        drop_duration, 242.0, 55.0, amplitude=1.0, method="exponential"
    )
    drop = lowpass(drop, 240.0, q=1.8)
    drop_env = adsr(
        drop_duration,
        EnvelopeSettings(0.002, 0.28, 0.0, 0.0, "exponential"),
    )
    drop = apply_envelope(drop, drop_env)
    sub_tail = damped_sine(duration, 55.0, decay_time=0.22, amplitude=0.85)

    surge = bandpass_noise(duration, 1_400.0, q=0.9, seed=3_401)
    surge = _fast_decay_tail(0.16, surge)
    surge_env = adsr(
        duration,
        EnvelopeSettings(0.06, 0.12, 0.55, 0.28, "cubic"),
    )
    surge = scale(apply_envelope(surge, surge_env), 0.40)
    crackle = scale(
        _fast_decay_tail(0.05, bandpass_noise(0.080, 3_800.0, q=3.0, seed=3_402)),
        0.14,
    )
    chime_start = 0.22
    spark_chime = _bell_voice(
        duration - chime_start,
        OVERDRIVE_CHIME_FREQUENCY,
        start_seconds=chime_start,
        decay_time=0.12,
        amplitude=0.30,
        strike_seed=3_403,
    )
    signal = mix(
        _pad_to_length(drop, total_samples),
        sub_tail,
        surge,
        _pad_to_length(crackle, total_samples),
        spark_chime,
    )
    return SfxSound(signal=signal, tier_peak_dbfs=TIER4_PEAK_DBFS)


# ---------------------------------------------------------------------------
# Step 3.3 — Combo breaker & streak ambience
# ---------------------------------------------------------------------------


def combo_breaker() -> SfxSound:
    """Soft flame fizzle / steam puff (breaking a 25+ streak), 200 ms."""
    duration = SFX_BREAKER_DURATION
    puff = lowpass(white_noise(duration, seed=3_501), 1_500.0)
    puff_env = adsr(
        duration,
        EnvelopeSettings(0.012, 0.060, 0.30, 0.110, "cubic"),
    )
    puff = apply_envelope(puff, puff_env)
    hiss = bandpass_noise(duration, 4_200.0, q=1.4, seed=3_502)
    hiss_env = adsr(
        duration,
        EnvelopeSettings(0.006, 0.040, 0.20, 0.140, "exponential"),
    )
    hiss = apply_envelope(hiss, hiss_env)
    steam = damped_sine(duration, 310.0, decay_time=0.050, amplitude=0.12)
    signal = mix(scale(puff, 0.85), scale(hiss, 0.35), steam)
    return SfxSound(signal=signal, tier_peak_dbfs=TIER3_PEAK_DBFS)


def streak_flame() -> SfxSound:
    """Very subtle low fire whoosh with a smooth fade, 300 ms."""
    duration = SFX_STREAK_DURATION
    whoosh = lowpass(pink_noise(duration, seed=3_601), 500.0)
    flicker = bandpass_noise(duration, 900.0, q=0.8, seed=3_602)
    body = mix(scale(whoosh, 0.9), scale(flicker, 0.18))
    swell = adsr(
        duration,
        EnvelopeSettings(0.08, 0.10, 0.70, 0.10, "cubic"),
    )
    body = apply_envelope(body, swell)
    breath = damped_sine(duration, 90.0, decay_time=0.18, amplitude=0.20)
    signal = mix(body, breath)
    return SfxSound(signal=signal, tier_peak_dbfs=TIER3_PEAK_DBFS)


SFX_RECIPES: dict[str, Callable[[], SfxSound]] = {
    ERROR_KNOCK: error_knock,
    COUNTDOWN_TICK: countdown_tick,
    COMBO_SPARK_10: combo_spark_10,
    COMBO_BLAZE_25: combo_blaze_25,
    COMBO_INFERNO_50: combo_inferno_50,
    COMBO_OVERDRIVE_100: combo_overdrive_100,
    COMBO_BREAKER: combo_breaker,
    STREAK_FLAME: streak_flame,
}


def sfx_sound(filename: str) -> SfxSound:
    """Dispatch an SFX recipe by manifest filename."""
    factory = SFX_RECIPES.get(filename)
    if factory is None:
        raise ValueError(f"unknown sfx file: {filename}")
    return factory()
