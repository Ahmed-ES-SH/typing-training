"""Layered DSP recipes for the Phase 2 mechanical switch packs.

Every recipe returns a :class:`SwitchSound` holding a raw float signal plus
the tier peak level it must be normalized to. All recipes are deterministic,
so generation can be re-run and byte-compared reproducibly. Use
:func:`finalize` to apply the fade-out, DC removal, and tier normalization
before writing a WAV file.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from dsp_synthesis import (
    SAMPLE_RATE,
    EnvelopeSettings,
    adsr,
    apply_envelope,
    bandpass_noise,
    damped_sine,
    frequency_sweep,
    lowpass,
    mix,
    normalize_peak,
    pink_noise,
    remove_dc_offset,
    scale,
    sine,
    triangle,
    white_noise,
)

TIER1_PEAK_DBFS = -12.0  # alphanumeric presses
TIER2_PEAK_DBFS = -9.0  # space / enter / backspace
CEILING_DBFS = -3.0  # absolute master ceiling

THOCK_DURATION = 0.045  # 45 ms presses (30-50 ms window)
THOCK_SPACE_DURATION = 0.080  # 80 ms (60-90 ms window)
THOCK_ENTER_DURATION = 0.070  # 70 ms (50-80 ms window)
THOCK_BACKSPACE_DURATION = 0.040  # 40 ms (30-50 ms window)

CLICKY_DURATION = 0.050  # 50 ms presses (30-60 ms window)
CLICKY_SPACE_DURATION = 0.090  # 90 ms (70-100 ms window)
CLICKY_ENTER_DURATION = 0.080  # 80 ms (60-90 ms window)
CLICKY_BACKSPACE_DURATION = 0.040  # 40 ms (30-50 ms window)

MODEL_M_DURATION = 0.065  # 65 ms presses (40-80 ms window)
MODEL_M_SPACE_DURATION = 0.105  # 105 ms (80-120 ms window)
MODEL_M_ENTER_DURATION = 0.090  # 90 ms (70-100 ms window)

SYNTH_DURATION = 0.032  # 32 ms presses (25-40 ms window)
SYNTH_SPACE_DURATION = 0.062  # 62 ms (50-70 ms window)

TRAILING_FADE_MS = 3.0


@dataclass(frozen=True)
class SwitchSound:
    """A raw switch signal plus the peak level it must be normalized to."""

    signal: list[float]
    tier_peak_dbfs: float


def _seconds_to_samples(seconds: float) -> int:
    return max(1, round(seconds * SAMPLE_RATE))


def _pad_to_length(signal: list[float], target_length: int) -> list[float]:
    if len(signal) >= target_length:
        return signal[:target_length]
    return signal + [0.0] * (target_length - len(signal))


def _delay(signal: list[float], delay_seconds: float) -> list[float]:
    """Shift a signal later in time, padding its head with silence."""
    offset = round(delay_seconds * SAMPLE_RATE)
    if offset <= 0:
        return list(signal)
    return [0.0] * offset + list(signal)


def _impulse(
    duration: float,
    center_frequency: float,
    q: float,
    decay_time: float,
    seed: int,
    amplitude: float = 1.0,
) -> list[float]:
    """Bandpass-filtered noise transient with an exponential decay tail."""
    transient = bandpass_noise(duration, center_frequency, q=q, seed=seed)
    decay_samples = _seconds_to_samples(decay_time)
    return [
        amplitude * sample * math.exp(-index / decay_samples)
        for index, sample in enumerate(transient)
    ]


def _fast_decay_tail(decay_time: float, samples: list[float]) -> list[float]:
    decay_samples = _seconds_to_samples(decay_time)
    return [
        sample * math.exp(-index / decay_samples)
        for index, sample in enumerate(samples)
    ]


def _click_bar(
    duration: float = 0.010,
    center_frequency: float = 2_850.0,
    seed: int = 0,
    amplitude: float = 1.0,
) -> list[float]:
    """High-Q metallic snap: 1.2 ms rise, ~6 ms decay (click-bar character)."""
    snap = bandpass_noise(duration, center_frequency, q=6.0, seed=seed)
    rise_samples = _seconds_to_samples(0.0012)
    decay_samples = _seconds_to_samples(0.006)
    shaped: list[float] = []
    for index, sample in enumerate(snap):
        rise = min(1.0, index / rise_samples)
        decay = math.exp(-index / decay_samples)
        shaped.append(amplitude * sample * rise * decay)
    return shaped


def _spring_ping(
    duration: float = 0.035,
    amplitude: float = 1.0,
    detune: float = 1.0,
) -> list[float]:
    """Dual high-mid sine modes with the Model M's lingering ringing tail."""
    return mix(
        damped_sine(
            duration,
            1_350.0 * detune,
            decay_time=0.014,
            amplitude=0.60 * amplitude,
        ),
        damped_sine(
            duration,
            1_680.0 * detune,
            decay_time=0.020,
            amplitude=0.40 * amplitude,
            phase=0.7,
        ),
    )


def _thock_body(
    duration: float,
    detune: float,
    amplitude: float,
    decay_scale: float = 1.0,
) -> list[float]:
    """Damped low-mid modal body at 95/145/220 Hz detuned by up to ±3%."""
    modes: list[list[float]] = []
    for index, base_frequency in enumerate((95.0, 145.0, 220.0)):
        mode_detune = 1.0 + detune * ((index % 3) - 1) * 0.5
        modes.append(
            damped_sine(
                duration,
                base_frequency * mode_detune,
                decay_time=(0.010 + 0.004 * index) * decay_scale,
                amplitude=amplitude * (1.0 - 0.18 * index),
            )
        )
    return mix(*modes)


def _housing_reflection(
    duration: float,
    cutoff: float,
    seed: int,
    amplitude: float,
    decay_time: float = 0.010,
) -> list[float]:
    """Low-pass pink noise burst simulating lubricated housing reflections."""
    burst = lowpass(pink_noise(duration, seed=seed), cutoff)
    return scale(_fast_decay_tail(decay_time, burst), amplitude)


def finalize(sound: SwitchSound) -> list[float]:
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
# Thock pack (lubed linear, Gateron Ink Black character)
# ---------------------------------------------------------------------------


def thock_press(variation: int) -> SwitchSound:
    """Lubed linear press: dual-stage impulse, modal body, housing reflection."""
    duration = THOCK_DURATION
    seed = 100 + variation
    detune = 0.03 if variation % 2 == 0 else -0.03
    softer = variation == 3
    brighter = variation == 4

    body_amplitude = 0.80 if softer else 1.0
    impact_center = 1_700.0 + 250.0 * variation
    impact_amplitude = 0.55 if softer else 0.80
    reflection_cutoff = 700.0 if brighter else 450.0

    impact = _impulse(
        0.007,
        impact_center,
        q=1.6,
        decay_time=0.0025,
        seed=seed,
        amplitude=impact_amplitude,
    )
    body = _thock_body(duration, detune, body_amplitude)
    reflection = _housing_reflection(
        0.014,
        reflection_cutoff,
        seed + 11,
        amplitude=0.30,
    )
    sub = damped_sine(
        duration,
        92.0 * (1.0 + detune),
        decay_time=0.026,
        amplitude=0.35,
    )
    signal = mix(
        _pad_to_length(impact, len(body)),
        body,
        _pad_to_length(reflection, len(body)),
        sub,
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER1_PEAK_DBFS)


def thock_space() -> SwitchSound:
    """Deep resonant stabilized spacebar thud with a heavier sub component."""
    duration = THOCK_SPACE_DURATION
    impact = _impulse(0.010, 900.0, q=1.2, decay_time=0.004, seed=211, amplitude=0.90)
    body = _thock_body(duration, detune=0.0, amplitude=1.15, decay_scale=1.9)
    sub = damped_sine(duration, 68.0, decay_time=0.045, amplitude=0.85)
    stabilizer = damped_sine(duration, 310.0, decay_time=0.020, amplitude=0.18)
    reflection = _housing_reflection(0.022, 380.0, seed=222, amplitude=0.35, decay_time=0.016)
    signal = mix(
        _pad_to_length(impact, len(body)),
        body,
        sub,
        stabilizer,
        _pad_to_length(reflection, len(body)),
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER2_PEAK_DBFS)


def thock_enter() -> SwitchSound:
    """Authoritative mechanical return clack with a firm low body."""
    duration = THOCK_ENTER_DURATION
    impact = _impulse(0.009, 1_450.0, q=1.4, decay_time=0.0035, seed=311, amplitude=1.0)
    body = _thock_body(duration, detune=0.015, amplitude=1.05, decay_scale=1.5)
    snap = damped_sine(duration, 640.0, decay_time=0.012, amplitude=0.22)
    reflection = _housing_reflection(0.018, 520.0, seed=322, amplitude=0.32, decay_time=0.013)
    signal = mix(
        _pad_to_length(impact, len(body)),
        body,
        snap,
        _pad_to_length(reflection, len(body)),
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER2_PEAK_DBFS)


def thock_backspace() -> SwitchSound:
    """Light, quick mechanical tap with a shortened body."""
    duration = THOCK_BACKSPACE_DURATION
    impact = _impulse(0.006, 2_100.0, q=1.5, decay_time=0.002, seed=411, amplitude=0.75)
    body = _thock_body(duration, detune=-0.015, amplitude=0.70, decay_scale=0.7)
    reflection = _housing_reflection(0.010, 600.0, seed=422, amplitude=0.22, decay_time=0.008)
    signal = mix(
        _pad_to_length(impact, len(body)),
        body,
        _pad_to_length(reflection, len(body)),
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER2_PEAK_DBFS)


# ---------------------------------------------------------------------------
# Clicky pack (tactile click-bar, Cherry MX Blue / Box White character)
# ---------------------------------------------------------------------------


def clicky_press(variation: int) -> SwitchSound:
    """Sharp tactile click snap plus a delayed low bottom-out tap."""
    duration = CLICKY_DURATION
    seed = 500 + variation
    brighter = variation == 3
    softer = variation == 4

    snap_center = 3_050.0 if brighter else 2_700.0
    snap_amplitude = 0.55 if softer else 0.80
    tap_amplitude = 0.30 if softer else 0.45
    body_amplitude = 0.65 if softer else 0.85

    snap = _click_bar(0.010, snap_center, seed=seed, amplitude=snap_amplitude)
    tap = scale(
        _fast_decay_tail(
            0.008,
            lowpass(white_noise(0.014, seed=seed + 21), 320.0),
        ),
        tap_amplitude,
    )
    body = _thock_body(duration, detune=0.01 * variation, amplitude=body_amplitude, decay_scale=0.85)
    stem = damped_sine(duration, 180.0, decay_time=0.014, amplitude=0.40)
    signal = mix(
        _pad_to_length(snap, len(body)),
        _pad_to_length(_delay(tap, 0.008), len(body)),
        body,
        stem,
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER1_PEAK_DBFS)


def clicky_space() -> SwitchSound:
    """Large key sound with a distinct stabilizer wire clack."""
    duration = CLICKY_SPACE_DURATION
    snap = _click_bar(0.012, 2_600.0, seed=611, amplitude=0.75)
    wire = damped_sine(duration, 1_800.0, decay_time=0.015, amplitude=0.35)
    body = _thock_body(duration, detune=0.0, amplitude=1.05, decay_scale=1.6)
    sub = damped_sine(duration, 75.0, decay_time=0.040, amplitude=0.70)
    clack = scale(
        _fast_decay_tail(0.010, bandpass_noise(0.016, 1_150.0, q=1.2, seed=622)),
        0.55,
    )
    signal = mix(
        _pad_to_length(snap, len(body)),
        wire,
        body,
        sub,
        _pad_to_length(_delay(clack, 0.006), len(body)),
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER2_PEAK_DBFS)


def clicky_enter() -> SwitchSound:
    """Heavy tactile latch click with a firm mechanical body."""
    duration = CLICKY_ENTER_DURATION
    snap = _click_bar(0.012, 2_450.0, seed=711, amplitude=0.80)
    latch = scale(
        _fast_decay_tail(0.009, bandpass_noise(0.014, 900.0, q=1.6, seed=722)),
        0.60,
    )
    body = _thock_body(duration, detune=0.0, amplitude=1.00, decay_scale=1.4)
    stem = damped_sine(duration, 190.0, decay_time=0.020, amplitude=0.50)
    signal = mix(
        _pad_to_length(snap, len(body)),
        _pad_to_length(_delay(latch, 0.004), len(body)),
        body,
        stem,
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER2_PEAK_DBFS)


def clicky_backspace() -> SwitchSound:
    """Quick crisp click with a light bottom-out."""
    duration = CLICKY_BACKSPACE_DURATION
    snap = _click_bar(0.009, 2_950.0, seed=811, amplitude=0.70)
    tap = scale(
        _fast_decay_tail(0.006, lowpass(white_noise(0.012, seed=822), 380.0)),
        0.38,
    )
    body = _thock_body(duration, detune=-0.01, amplitude=0.70, decay_scale=0.7)
    signal = mix(
        _pad_to_length(snap, len(body)),
        _pad_to_length(_delay(tap, 0.006), len(body)),
        body,
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER2_PEAK_DBFS)


# ---------------------------------------------------------------------------
# Model M pack (vintage buckling spring)
# ---------------------------------------------------------------------------


def model_m_press(variation: int) -> SwitchSound:
    """Buckling spring press: buckle spike, dual-mode ping, steel-backplate thud."""
    duration = MODEL_M_DURATION
    seed = 900 + variation
    detune = 1.0 + (variation - 2) * 0.015
    ping_amplitude = 0.55 if variation == 3 else 0.70

    buckle = _impulse(0.005, 1_800.0, q=2.4, decay_time=0.0018, seed=seed, amplitude=0.75)
    clack = scale(
        _fast_decay_tail(0.007, lowpass(white_noise(0.016, seed=seed + 31), 900.0)),
        0.65,
    )
    ping = _spring_ping(0.035, amplitude=ping_amplitude, detune=detune)
    plate = damped_sine(duration, 110.0, decay_time=0.022, amplitude=0.85)
    body = _thock_body(duration, detune=0.008 * variation, amplitude=0.55, decay_scale=1.1)
    signal = mix(
        _pad_to_length(buckle, len(body)),
        _pad_to_length(clack, len(body)),
        _pad_to_length(ping, len(body)),
        plate,
        body,
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER1_PEAK_DBFS)


def model_m_space() -> SwitchSound:
    """Chunky steel spacebar thud with wire resonance."""
    duration = MODEL_M_SPACE_DURATION
    impact = _impulse(0.010, 750.0, q=1.1, decay_time=0.004, seed=1_011, amplitude=0.95)
    wire = damped_sine(duration, 1_450.0, decay_time=0.028, amplitude=0.25)
    plate = damped_sine(duration, 96.0, decay_time=0.042, amplitude=1.00)
    body = _thock_body(duration, detune=0.0, amplitude=0.70, decay_scale=2.0)
    clack = scale(
        _fast_decay_tail(0.012, bandpass_noise(0.018, 1_050.0, q=1.0, seed=1_022)),
        0.55,
    )
    signal = mix(
        _pad_to_length(impact, len(body)),
        wire,
        plate,
        body,
        _pad_to_length(_delay(clack, 0.005), len(body)),
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER2_PEAK_DBFS)


def model_m_enter() -> SwitchSound:
    """Heavy vintage enter clack with a strong spring ping."""
    duration = MODEL_M_ENTER_DURATION
    buckle = _impulse(0.008, 1_600.0, q=2.0, decay_time=0.003, seed=1_111, amplitude=0.85)
    clack = scale(
        _fast_decay_tail(0.009, lowpass(white_noise(0.018, seed=1_122), 850.0)),
        0.70,
    )
    ping = _spring_ping(0.045, amplitude=0.80, detune=0.985)
    plate = damped_sine(duration, 104.0, decay_time=0.030, amplitude=0.90)
    signal = mix(
        _pad_to_length(buckle, len(plate)),
        _pad_to_length(clack, len(plate)),
        _pad_to_length(ping, len(plate)),
        plate,
    )
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER2_PEAK_DBFS)


# ---------------------------------------------------------------------------
# Cyber synth pack (clean sci-fi terminal)
# ---------------------------------------------------------------------------


def _synth_blip(
    duration: float,
    frequency: float,
    blend: float,
    amplitude: float,
    attack_ms: float = 0.8,
) -> list[float]:
    """Additive sine/triangle blip with instant attack and smooth decay."""
    sine_signal = sine(duration, frequency)
    triangle_signal = triangle(duration, frequency * 2.0)
    raw = mix(
        sine_signal,
        scale(triangle_signal, blend * 0.4),
    )
    settings = EnvelopeSettings(attack_ms / 1000.0, duration * 0.9, 0.0, 0.0, "exponential")
    envelope = adsr(duration, settings)
    return scale(apply_envelope(raw, envelope), amplitude)


def _synth_lowpass_tail(
    samples: list[float], cutoff: float, q: float = 1.2
) -> list[float]:
    return lowpass(samples, cutoff, q=q)


def synth_press(variation: int) -> SwitchSound:
    """Clean futuristic terminal blip; pitch/timbre vary per slot."""
    duration = SYNTH_DURATION
    frequencies = (560.0, 660.0, 740.0)
    blends = (0.10, 0.25, 0.45)
    frequency = frequencies[variation - 1] * (0.99 if variation == 2 else 1.0)
    blend = blends[variation - 1]
    sub = damped_sine(duration, 240.0, decay_time=0.010, amplitude=0.18)
    signal = mix(_synth_blip(duration, frequency, blend, 1.0), sub)
    signal = _synth_lowpass_tail(signal, 6_500.0)
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER1_PEAK_DBFS)


def synth_space() -> SwitchSound:
    """Resonant low-pass pitch drop from 320 Hz down to 110 Hz."""
    duration = SYNTH_SPACE_DURATION
    drop = frequency_sweep(duration, 320.0, 110.0, amplitude=0.95, method="exponential")
    resonant = _synth_lowpass_tail(drop, 700.0, q=2.5)
    sub = damped_sine(duration, 82.0, decay_time=0.035, amplitude=0.55)
    sparkle = scale(
        _fast_decay_tail(0.020, bandpass_noise(0.030, 3_200.0, q=4.0, seed=1_211)),
        0.10,
    )
    signal = mix(resonant, sub, _pad_to_length(sparkle, len(resonant)))
    return SwitchSound(signal=signal, tier_peak_dbfs=TIER2_PEAK_DBFS)


def press_sound(pack: str, variation: int) -> SwitchSound:
    """Dispatch an alphanumeric press recipe by pack name (1-based variation)."""
    if pack == "thock":
        return thock_press(variation)
    if pack == "clicky":
        return clicky_press(variation)
    if pack == "model-m":
        return model_m_press(variation)
    if pack == "synth":
        return synth_press(variation)
    raise ValueError(f"unknown switch pack: {pack}")
