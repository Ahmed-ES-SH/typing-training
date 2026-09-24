"""Layered DSP recipes for the Phase 4 milestone fanfares.

Unlike the switch and SFX packs, fanfares render as true stereo: every
recipe builds a (left, right) channel pair from equal-power panning,
decorrelated noise beds, and optional right-channel micro-delays
(Haas widening), so milestones land on a wide, immersive soundstage.
All recipes are deterministic, so generation can be re-run reproducibly.
Use :func:`fanfare_finalize` to apply the DC removal, trailing fade,
and joint peak normalization before writing a WAV file.

Loudness hierarchy (plan section 3.2):
- Tier 5 (-3 dBFS peak): milestone fanfares, the loudest layer in the
  library, reserved for achievements and major milestones.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

from dsp_synthesis import (
    SAMPLE_RATE,
    EnvelopeSettings,
    adsr,
    apply_envelope,
    bandpass_noise,
    db_to_linear,
    damped_sine,
    frequency_sweep,
    highpass,
    karplus_strong,
    lowpass,
    mix,
    peak,
    remove_dc_offset,
    scale,
    sine,
    white_noise,
)
from sfx_synth import _bell_voice
from switch_synth import (
    _delay,
    _fast_decay_tail,
    _impulse,
    _pad_to_length,
    _seconds_to_samples,
)

TIER5_PEAK_DBFS = -3.0  # milestone fanfares (plan loudness tier 5)
CEILING_DBFS = -3.0  # absolute master ceiling (inherited from the plan)

GATE_PASS_DURATION = 1.5  # 1.5 s progression swell (1.2-1.8 s window)
PERSONAL_BEST_DURATION = 1.2  # 1.2 s arpeggio shimmer (1.0-1.5 s window)
LEVEL_CLEARED_DURATION = 2.5  # 2.5 s triumphant fanfare (2.0-3.0 s window)
RANK_UP_DURATION = 2.0  # 2.0 s cyber power-up (1.5-2.5 s window)

TRAILING_FADE_MS = 120.0  # gentle cosine fade so decaying tails never click
MIN_AUDIBLE_RMS = 0.005
MAX_RAW_PEAK = 4.0  # raw mixtures must stay bounded before normalization

GATE_PASS = "gate_pass.wav"
PERSONAL_BEST = "personal_best.wav"
LEVEL_CLEARED = "level_cleared.wav"
RANK_UP = "rank_up.wav"

# Equal-temperament pitches (A4 = 440 Hz) used by the fanfare voices.
C2 = 65.41
F2 = 87.31
C3 = 130.81
E3 = 164.81
F3 = 174.61
G3 = 196.00
A3 = 220.00
C4 = 261.63
D4 = 293.66
E4 = 329.63
F4 = 349.23
FS4 = 369.99  # F#4
G4 = 392.00
A4 = 440.00
B4 = 493.88
C5 = 523.25
D5 = 587.33
E5 = 659.26
G5 = 783.99
A5 = 880.00
E6 = 1318.51


@dataclass(frozen=True)
class FanfareSound:
    """A raw stereo fanfare plus the peak level it must be normalized to."""

    left: list[float]
    right: list[float]
    tier_peak_dbfs: float


def _cosine_fade_out(signal: list[float], fade_ms: float) -> list[float]:
    """Smooth cosine fade across the tail so decaying voices never click."""
    fade_samples = _seconds_to_samples(fade_ms / 1000.0)
    fade_start = max(0, len(signal) - fade_samples)
    span = len(signal) - fade_start
    output = list(signal)
    for index in range(fade_start, len(signal)):
        progress = (index - fade_start) / max(1, span - 1)
        output[index] *= 0.5 * (1.0 + math.cos(math.pi * progress))
    return output


def fanfare_finalize(sound: FanfareSound) -> tuple[list[float], list[float]]:
    """Apply DC removal, trailing fade, and joint stereo peak normalization.

    Both channels share one normalization gain computed from the loudest
    sample across the pair, which preserves the stereo balance exactly.
    """
    left = _cosine_fade_out(remove_dc_offset(sound.left), TRAILING_FADE_MS)
    right = _cosine_fade_out(remove_dc_offset(sound.right), TRAILING_FADE_MS)
    joint_peak = max(peak(left), peak(right))
    if joint_peak == 0:
        return left, right
    gain = db_to_linear(sound.tier_peak_dbfs) / joint_peak
    return scale(left, gain), scale(right, gain)


# ---------------------------------------------------------------------------
# Stereo placement helpers
# ---------------------------------------------------------------------------


def _place(
    signal: list[float],
    pan: float = 0.0,
    width_delay_ms: float = 0.0,
) -> tuple[list[float], list[float]]:
    """Equal-power pan with optional right-channel micro-delay (Haas width)."""
    angle = (pan + 1.0) * (math.pi / 4.0)
    left = scale(signal, math.cos(angle))
    right = scale(signal, math.sin(angle))
    if width_delay_ms > 0:
        right = _delay(right, width_delay_ms / 1000.0)
    return left, right


def _render_stereo(
    parts: list[tuple[list[float], list[float]]], total_samples: int
) -> tuple[list[float], list[float]]:
    left = mix(*(_pad_to_length(left_part, total_samples) for left_part, _ in parts))
    right = mix(*(_pad_to_length(right_part, total_samples) for _, right_part in parts))
    return left, right


def _stereo_noise_pair(
    duration: float,
    frequency: float,
    q: float,
    seed_left: int,
    seed_right: int,
    kind: str = "bandpass",
) -> tuple[list[float], list[float]]:
    """Two independent, identically shaped noise realizations (L/R width)."""
    if kind == "bandpass":
        left = bandpass_noise(duration, frequency, q=q, seed=seed_left)
        right = bandpass_noise(duration, frequency, q=q, seed=seed_right)
    elif kind == "highpass":
        left = highpass(white_noise(duration, seed=seed_left), frequency, q=q)
        right = highpass(white_noise(duration, seed=seed_right), frequency, q=q)
    else:  # lowpass
        left = lowpass(white_noise(duration, seed=seed_left), frequency, q=q)
        right = lowpass(white_noise(duration, seed=seed_right), frequency, q=q)
    return left, right


# ---------------------------------------------------------------------------
# Instrument voices
# ---------------------------------------------------------------------------


def _pad_voice(
    duration: float,
    frequency: float,
    amplitude: float = 1.0,
    attack: float = 0.20,
    sustain: float = 0.72,
    release_ratio: float = 0.28,
    detune: float = 1.0,
) -> list[float]:
    """Soft sustained chord tone: gentle partial stack plus a unison shimmer."""
    partials = [
        sine(duration, frequency * harmonic * detune, amplitude=level)
        for harmonic, level in ((1, 1.0), (2, 0.32), (3, 0.14))
    ]
    partials.append(sine(duration, frequency * detune * 1.005, amplitude=0.40))
    raw = mix(*partials)
    envelope = adsr(
        duration,
        EnvelopeSettings(attack, duration * 0.10, sustain, duration * release_ratio, "cubic"),
    )
    return scale(apply_envelope(raw, envelope), amplitude)


def _brass_voice(
    duration: float,
    frequency: float,
    amplitude: float = 1.0,
    attack: float = 0.025,
    sustain: float = 0.82,
    release_ratio: float = 0.30,
    detune: float = 1.0,
    dark_cutoff: float = 850.0,
    bright_cutoff: float = 3600.0,
    open_amount: float = 0.9,
) -> list[float]:
    """Brass/synth hybrid tone whose filter opens over the note (bwah swell)."""
    partials = [
        sine(duration, frequency * harmonic * detune, amplitude=level)
        for harmonic, level in ((1, 1.0), (2, 0.55), (3, 0.34), (4, 0.20))
        if frequency * harmonic * detune < SAMPLE_RATE * 0.45
    ]
    partials.append(sine(duration, frequency * detune * 1.004, amplitude=0.45))
    raw = mix(*partials)
    envelope = adsr(
        duration,
        EnvelopeSettings(attack, duration * 0.08, sustain, duration * release_ratio, "cubic"),
    )
    voiced = apply_envelope(raw, envelope)

    dark = lowpass(voiced, dark_cutoff, q=0.8)
    bright = lowpass(voiced, bright_cutoff, q=0.7)
    open_start = round(0.15 * len(voiced))
    swept: list[float] = []
    for index, (dark_sample, bright_sample) in enumerate(zip(dark, bright)):
        if index <= open_start:
            ramp = 0.0
        else:
            ramp = open_amount * (index - open_start) / max(1, len(voiced) - open_start)
        swept.append(dark_sample * (1.0 - ramp) + bright_sample * ramp)
    return scale(swept, amplitude)


def _sub_voice(
    duration: float,
    frequency: float,
    amplitude: float = 1.0,
) -> list[float]:
    """Pure sine foundation with an attack/decay/release that ends at zero."""
    raw = sine(duration, frequency)
    envelope = adsr(
        duration,
        EnvelopeSettings(0.05, 0.10, 0.60, 0.30, "cubic"),
    )
    return scale(apply_envelope(raw, envelope), amplitude)


HARP_DECAY_SECONDS = 0.16


def _harp_pluck(
    duration: float,
    frequency: float,
    seed: int,
    amplitude: float = 1.0,
) -> list[float]:
    """Karplus-Strong harp pluck with a string-dependent damping factor."""
    period = max(2, round(SAMPLE_RATE / frequency))
    damping = 1.0 - period / (HARP_DECAY_SECONDS * SAMPLE_RATE)
    pluck = karplus_strong(duration, frequency, damping=damping, seed=seed)
    return scale(_fast_decay_tail(0.20, pluck), amplitude)


# ---------------------------------------------------------------------------
# Step 4.1 — Achievements
# ---------------------------------------------------------------------------


def gate_pass() -> FanfareSound:
    """1.5 s uplifting Fmaj7 -> Cmaj9 chord-progression swell."""
    total_samples = _seconds_to_samples(GATE_PASS_DURATION)
    parts: list[tuple[list[float], list[float]]] = []

    # Opening bell strike doubles as the guaranteed immediate transient.
    opening_bell = _bell_voice(
        0.45, F4, start_seconds=0.0, decay_time=0.13, amplitude=0.30, strike_seed=4101
    )
    parts.append(_place(opening_bell, pan=-0.10))

    # Fmaj7 swell: F3 - A3 - C4 - E4 over an F2 foundation.
    for frequency, amplitude, pan in (
        (F3, 0.50, -0.30),
        (A3, 0.42, -0.55),
        (C4, 0.40, 0.30),
        (E4, 0.36, 0.55),
    ):
        voice = _pad_voice(0.85, frequency, amplitude=amplitude, attack=0.22)
        parts.append(_place(voice, pan=pan, width_delay_ms=6.0))
    parts.append(_place(_sub_voice(0.85, F2, amplitude=0.30)))

    # Cmaj9 answer: C3 - E3 - G3 - D4 over a C2 foundation.
    chord_start = 0.68
    for frequency, amplitude, pan in (
        (C3, 0.50, -0.35),
        (E3, 0.42, -0.15),
        (G3, 0.40, 0.20),
        (D4, 0.36, 0.50),
    ):
        voice = _delay(
            _pad_voice(0.82, frequency, amplitude=amplitude, attack=0.18), chord_start
        )
        parts.append(_place(voice, pan=pan, width_delay_ms=6.0))
    parts.append(_place(_delay(_sub_voice(0.82, C2, amplitude=0.30), chord_start)))

    # Sparkle accents riding the resolution.
    first_accent = _bell_voice(
        0.35, C5, start_seconds=0.78, decay_time=0.11, amplitude=0.16, strike_seed=4102
    )
    second_accent = _bell_voice(
        0.35, E5, start_seconds=1.02, decay_time=0.10, amplitude=0.14, strike_seed=4103
    )
    parts.append(_place(first_accent, pan=0.40, width_delay_ms=6.0))
    parts.append(_place(second_accent, pan=-0.40, width_delay_ms=6.0))

    # Decorrelated shimmer and warm beds keep the soundstage wide.
    shimmer_envelope = adsr(
        GATE_PASS_DURATION, EnvelopeSettings(0.55, 0.15, 0.35, 0.45, "cubic")
    )
    shimmer_left, shimmer_right = _stereo_noise_pair(
        GATE_PASS_DURATION, 5600.0, q=4.0, seed_left=4104, seed_right=4105
    )
    parts.append(
        (
            scale(apply_envelope(shimmer_left, shimmer_envelope), 0.045),
            scale(apply_envelope(shimmer_right, shimmer_envelope), 0.045),
        )
    )
    bed_envelope = adsr(
        GATE_PASS_DURATION, EnvelopeSettings(0.40, 0.20, 0.50, 0.40, "cubic")
    )
    bed_left, bed_right = _stereo_noise_pair(
        GATE_PASS_DURATION, 700.0, q=0.7, seed_left=4106, seed_right=4107, kind="lowpass"
    )
    parts.append(
        (
            scale(apply_envelope(bed_left, bed_envelope), 0.05),
            scale(apply_envelope(bed_right, bed_envelope), 0.05),
        )
    )

    left, right = _render_stereo(parts, total_samples)
    return FanfareSound(left=left, right=right, tier_peak_dbfs=TIER5_PEAK_DBFS)


ARP_FREQUENCIES = (C4, D4, E4, G4, A4, C5, D5, E5, G5, A5)
ARP_PANS = (-0.40, 0.35, -0.25, 0.45, -0.50, 0.30, -0.35, 0.50, -0.45, 0.40)
ARP_SPACING_SECONDS = 0.12


def personal_best() -> FanfareSound:
    """1.2 s sparkling ascending harp-like shimmer arpeggio."""
    total_samples = _seconds_to_samples(PERSONAL_BEST_DURATION)
    parts: list[tuple[list[float], list[float]]] = []

    for index, (frequency, pan) in enumerate(zip(ARP_FREQUENCIES, ARP_PANS)):
        start = ARP_SPACING_SECONDS * index
        amplitude = 0.55 + 0.035 * index  # gentle crescendo up the arpeggio
        pluck = _harp_pluck(
            0.30, frequency, seed=4200 + index, amplitude=amplitude
        )
        parts.append(_place(_delay(pluck, start), pan=pan))

    parts.append(_place(_sub_voice(PERSONAL_BEST_DURATION, C3, amplitude=0.18)))

    sparkle = _bell_voice(
        0.30,
        E6,
        start_seconds=0.55,
        decay_time=0.09,
        amplitude=0.10,
        strike_seed=4210,
    )
    parts.append(_place(sparkle, pan=0.20, width_delay_ms=5.0))

    shimmer_envelope = adsr(
        PERSONAL_BEST_DURATION, EnvelopeSettings(0.45, 0.15, 0.35, 0.35, "cubic")
    )
    shimmer_left, shimmer_right = _stereo_noise_pair(
        PERSONAL_BEST_DURATION, 7200.0, q=5.0, seed_left=4211, seed_right=4212
    )
    parts.append(
        (
            scale(apply_envelope(shimmer_left, shimmer_envelope), 0.04),
            scale(apply_envelope(shimmer_right, shimmer_envelope), 0.04),
        )
    )
    bed_envelope = adsr(
        PERSONAL_BEST_DURATION, EnvelopeSettings(0.40, 0.15, 0.50, 0.30, "cubic")
    )
    bed_left, bed_right = _stereo_noise_pair(
        PERSONAL_BEST_DURATION, 600.0, q=0.7, seed_left=4213, seed_right=4214, kind="lowpass"
    )
    parts.append(
        (
            scale(apply_envelope(bed_left, bed_envelope), 0.05),
            scale(apply_envelope(bed_right, bed_envelope), 0.05),
        )
    )

    left, right = _render_stereo(parts, total_samples)
    return FanfareSound(left=left, right=right, tier_peak_dbfs=TIER5_PEAK_DBFS)


# ---------------------------------------------------------------------------
# Step 4.2 — Major milestones
# ---------------------------------------------------------------------------


def level_cleared() -> FanfareSound:
    """2.5 s triumphant brass/synth hybrid fanfare with stereo widening."""
    total_samples = _seconds_to_samples(LEVEL_CLEARED_DURATION)
    parts: list[tuple[list[float], list[float]]] = []

    # Opening impact: noise burst, timpani thud, and a fast sub drop.
    parts.append(
        _place(_impulse(0.014, 1000.0, q=1.2, decay_time=0.006, seed=4301, amplitude=0.55))
    )
    drop = frequency_sweep(0.30, 150.0, 58.0, method="exponential")
    drop = lowpass(drop, 320.0, q=1.2)
    drop = apply_envelope(
        drop, adsr(0.30, EnvelopeSettings(0.002, 0.27, 0.0, 0.0, "exponential"))
    )
    parts.append(_place(scale(drop, 0.90)))
    timpani = damped_sine(0.50, 98.0, decay_time=0.18, amplitude=0.55)
    parts.append(_place(timpani, pan=-0.10))

    # Sustained string pad under the motif.
    pad_delay = 0.08
    parts.append(
        _place(
            _delay(_pad_voice(1.50, C3, amplitude=0.20, attack=0.35), pad_delay),
            pan=-0.15,
            width_delay_ms=7.0,
        )
    )
    parts.append(
        _place(
            _delay(_pad_voice(1.50, G3, amplitude=0.18, attack=0.35), pad_delay),
            pan=0.15,
            width_delay_ms=7.0,
        )
    )

    # Triumphant brass motif: C - C - E - G.
    motif = (
        (0.10, 0.26, C4, 0.42, -0.20),
        (0.40, 0.22, C4, 0.44, -0.20),
        (0.66, 0.30, E4, 0.44, 0.25),
        (1.00, 0.52, G4, 0.48, 0.25),
    )
    for start, duration, frequency, amplitude, pan in motif:
        voice = _brass_voice(
            duration, frequency, amplitude=amplitude, attack=0.025
        )
        parts.append(_place(_delay(voice, start), pan=pan, width_delay_ms=9.0))

    # Wide final chord: C4 - E4 - G4 - C5 over a C3 pad and C2 foundation.
    chord_start = 1.52
    for frequency, amplitude, pan in (
        (C4, 0.34, 0.0),
        (E4, 0.30, -0.60),
        (G4, 0.30, 0.60),
        (C5, 0.26, 0.0),
    ):
        voice = _brass_voice(
            0.98,
            frequency,
            amplitude=amplitude,
            attack=0.05,
            release_ratio=0.35,
        )
        parts.append(_place(voice, pan=pan, width_delay_ms=12.0))
    parts.append(_place(_pad_voice(0.98, C3, amplitude=0.22, attack=0.10)))
    parts.append(_place(_delay(_sub_voice(0.98, C2, amplitude=0.30), chord_start)))

    # Cymbal shimmer and a bell accent crown the resolution.
    cymbal_envelope = adsr(1.05, EnvelopeSettings(0.50, 0.10, 0.45, 0.35, "cubic"))
    cymbal_left, cymbal_right = _stereo_noise_pair(
        1.05, 6800.0, q=0.7, seed_left=4311, seed_right=4312, kind="highpass"
    )
    parts.append(
        (
            scale(_delay(apply_envelope(cymbal_left, cymbal_envelope), 1.45), 0.05),
            scale(_delay(apply_envelope(cymbal_right, cymbal_envelope), 1.45), 0.05),
        )
    )
    accent = _bell_voice(
        0.40, E5, start_seconds=1.60, decay_time=0.12, amplitude=0.16, strike_seed=4313
    )
    parts.append(_place(accent, pan=0.30, width_delay_ms=8.0))

    left, right = _render_stereo(parts, total_samples)
    return FanfareSound(left=left, right=right, tier_peak_dbfs=TIER5_PEAK_DBFS)


PING_FREQUENCIES = (E4, G4, A4, B4, D5, E5, G5, A5)
PING_START_SECONDS = 0.30
PING_SPACING_SECONDS = 0.14
HIT_START_SECONDS = 1.50


def rank_up() -> FanfareSound:
    """2.0 s cyberpunk power-up: sub boom, energy riser, and power hit."""
    total_samples = _seconds_to_samples(RANK_UP_DURATION)
    parts: list[tuple[list[float], list[float]]] = []

    # Power-up boom: exponential sub drop plus body and dark impact.
    boom = frequency_sweep(0.34, 130.0, 46.0, method="exponential")
    boom = lowpass(boom, 240.0, q=1.3)
    boom = apply_envelope(
        boom, adsr(0.34, EnvelopeSettings(0.002, 0.30, 0.0, 0.0, "exponential"))
    )
    parts.append(_place(boom))
    parts.append(_place(damped_sine(0.50, 62.0, decay_time=0.14, amplitude=0.50)))
    impact = _fast_decay_tail(0.010, lowpass(white_noise(0.02, seed=4401), 500.0))
    parts.append(_place(scale(impact, 0.50)))

    # Energy riser: detuned dual sweep plus decorrelated noise swell.
    riser_duration = 1.35
    sweep = mix(
        frequency_sweep(riser_duration, 220.0, 880.0, method="exponential"),
        scale(frequency_sweep(riser_duration, 221.3, 885.0, method="exponential"), 0.6),
    )
    sweep = lowpass(sweep, 2600.0, q=1.1)
    sweep = apply_envelope(
        sweep, adsr(riser_duration, EnvelopeSettings(0.95, 0.05, 0.70, 0.30, "cubic"))
    )
    parts.append(_place(_delay(scale(sweep, 0.50), 0.15)))
    riser_envelope = adsr(
        riser_duration, EnvelopeSettings(1.00, 0.05, 0.65, 0.28, "cubic")
    )
    riser_left, riser_right = _stereo_noise_pair(
        riser_duration, 1900.0, q=0.8, seed_left=4402, seed_right=4403
    )
    parts.append(
        (
            scale(_delay(apply_envelope(riser_left, riser_envelope), 0.15), 0.14),
            scale(_delay(apply_envelope(riser_right, riser_envelope), 0.15), 0.14),
        )
    )

    # Ascending cyber pings build tension into the hit.
    for index, frequency in enumerate(PING_FREQUENCIES):
        start = PING_START_SECONDS + PING_SPACING_SECONDS * index
        ping = damped_sine(
            0.16, frequency, decay_time=0.05, amplitude=0.10 + 0.025 * index
        )
        pan = (-1.0) ** index * min(0.60, 0.30 + 0.05 * index)
        parts.append(_place(_delay(ping, start), pan=pan))

    # Power hit at 1.5 s: impact, sub tail, sus2 stab, metallic ring, crackle.
    parts.append(
        _place(
            _delay(
                _impulse(
                    0.02, 1200.0, q=1.1, decay_time=0.010, seed=4404, amplitude=0.60
                ),
                HIT_START_SECONDS,
            )
        )
    )
    sub_hit = damped_sine(0.50, 55.0, decay_time=0.09, amplitude=0.85)
    parts.append(_place(_delay(sub_hit, HIT_START_SECONDS)))
    for frequency, amplitude, pan in (
        (E3, 0.30, -0.30),
        (B4, 0.30, 0.30),
        (E4, 0.26, -0.15),
        (FS4, 0.26, 0.15),
    ):
        stab = _brass_voice(
            0.50,
            frequency,
            amplitude=amplitude,
            attack=0.004,
            sustain=0.30,
            release_ratio=0.44,
            dark_cutoff=700.0,
            bright_cutoff=2200.0,
            open_amount=0.55,
        )
        parts.append(_place(_delay(stab, HIT_START_SECONDS), pan=pan, width_delay_ms=8.0))
    ring_low = damped_sine(0.45, 1244.0, decay_time=0.05, amplitude=0.10)
    ring_high = damped_sine(0.45, 1866.0, decay_time=0.04, amplitude=0.07)
    parts.append(_place(_delay(ring_low, HIT_START_SECONDS), pan=-0.20))
    parts.append(_place(_delay(ring_high, HIT_START_SECONDS), pan=0.20))
    crackle_left = _fast_decay_tail(
        0.06, bandpass_noise(0.30, 3800.0, q=3.0, seed=4405)
    )
    crackle_right = _fast_decay_tail(
        0.06, bandpass_noise(0.30, 3800.0, q=3.0, seed=4406)
    )
    parts.append(
        (
            scale(_delay(crackle_left, HIT_START_SECONDS), 0.12),
            scale(_delay(crackle_right, HIT_START_SECONDS), 0.12),
        )
    )

    left, right = _render_stereo(parts, total_samples)
    return FanfareSound(left=left, right=right, tier_peak_dbfs=TIER5_PEAK_DBFS)


FANFARE_RECIPES: dict[str, Callable[[], FanfareSound]] = {
    GATE_PASS: gate_pass,
    PERSONAL_BEST: personal_best,
    LEVEL_CLEARED: level_cleared,
    RANK_UP: rank_up,
}


def fanfare_sound(filename: str) -> FanfareSound:
    """Dispatch a fanfare recipe by manifest filename."""
    factory = FANFARE_RECIPES.get(filename)
    if factory is None:
        raise ValueError(f"unknown fanfare file: {filename}")
    return factory()
