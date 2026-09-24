from __future__ import annotations

import math
import random
import struct
import wave
from collections.abc import Sequence
from dataclasses import dataclass
from numbers import Real
from pathlib import Path
from typing import cast

SAMPLE_RATE = 48_000
BIT_DEPTH = 16
MAX_PCM_VALUE = 2 ** (BIT_DEPTH - 1) - 1


@dataclass(frozen=True)
class EnvelopeSettings:
    attack: float
    decay: float
    sustain: float
    release: float
    curve: str = "exponential"


def _validate_sample_rate(sample_rate: int) -> None:
    if not isinstance(sample_rate, int) or sample_rate <= 0:
        raise ValueError("sample_rate must be a positive integer")


def _sample_count(duration: float, sample_rate: int = SAMPLE_RATE) -> int:
    _validate_sample_rate(sample_rate)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("duration must be a positive finite number")
    return max(1, round(duration * sample_rate))


def _validate_frequency(frequency: float, sample_rate: int) -> None:
    if not math.isfinite(frequency) or frequency <= 0:
        raise ValueError("frequency must be a positive finite number")
    if frequency >= sample_rate / 2:
        raise ValueError("frequency must be below the Nyquist frequency")


def _validate_amplitude(amplitude: float) -> None:
    if not math.isfinite(amplitude):
        raise ValueError("amplitude must be finite")


def _validate_phase(phase: float) -> None:
    if not math.isfinite(phase):
        raise ValueError("phase must be finite")


def db_to_linear(decibels: float) -> float:
    return 10.0 ** (decibels / 20.0)


def sine(
    duration: float,
    frequency: float,
    amplitude: float = 1.0,
    phase: float = 0.0,
) -> list[float]:
    _validate_frequency(frequency, SAMPLE_RATE)
    _validate_amplitude(amplitude)
    _validate_phase(phase)
    return [
        amplitude * math.sin(2.0 * math.pi * frequency * index / SAMPLE_RATE + phase)
        for index in range(_sample_count(duration))
    ]


def triangle(
    duration: float,
    frequency: float,
    amplitude: float = 1.0,
    phase: float = 0.0,
) -> list[float]:
    _validate_frequency(frequency, SAMPLE_RATE)
    _validate_amplitude(amplitude)
    _validate_phase(phase)
    phase_cycles = phase / (2.0 * math.pi)
    return [
        amplitude
        * (
            1.0
            - 4.0 * abs((frequency * index / SAMPLE_RATE + phase_cycles) % 1.0 - 0.5)
        )
        for index in range(_sample_count(duration))
    ]


def white_noise(
    duration: float,
    amplitude: float = 1.0,
    seed: int = 0,
) -> list[float]:
    _validate_amplitude(amplitude)
    generator = random.Random(seed)
    return [
        generator.uniform(-amplitude, amplitude) for _ in range(_sample_count(duration))
    ]


def pink_noise(
    duration: float,
    amplitude: float = 1.0,
    seed: int = 0,
) -> list[float]:
    _validate_amplitude(amplitude)
    generator = random.Random(seed)
    total_samples = _sample_count(duration)
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0
    raw: list[float] = []
    for _ in range(total_samples):
        white = generator.uniform(-1.0, 1.0)
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.96900 * b2 + white * 0.1538520
        b3 = 0.86650 * b3 + white * 0.3104856
        b4 = 0.55000 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.0168980
        pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362
        b6 = white * 0.115926
        raw.append(pink)

    current_peak = max((abs(val) for val in raw), default=0.0)
    if current_peak == 0.0:
        return [0.0] * total_samples
    norm_factor = amplitude / current_peak
    return [val * norm_factor for val in raw]



def _filter_numerator(
    filter_type: str,
    cosine: float,
    alpha: float,
) -> tuple[float, float, float]:
    if filter_type == "lowpass":
        b0 = (1.0 - cosine) / 2.0
        return b0, 1.0 - cosine, b0
    if filter_type == "highpass":
        b0 = (1.0 + cosine) / 2.0
        return b0, -(1.0 + cosine), b0
    if filter_type == "bandpass":
        return alpha, 0.0, -alpha
    raise ValueError(f"unsupported filter type: {filter_type}")


def _biquad_coefficients(
    filter_type: str,
    frequency: float,
    q: float,
) -> tuple[float, float, float, float, float]:
    _validate_frequency(frequency, SAMPLE_RATE)
    if not math.isfinite(q) or q <= 0:
        raise ValueError("q must be a positive finite number")

    omega = 2.0 * math.pi * frequency / SAMPLE_RATE
    cosine = math.cos(omega)
    alpha = math.sin(omega) / (2.0 * q)
    b0, b1, b2 = _filter_numerator(filter_type, cosine, alpha)
    a0 = 1.0 + alpha
    a1 = -2.0 * cosine
    a2 = 1.0 - alpha
    return b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0


def apply_biquad(
    samples: Sequence[float],
    coefficients: tuple[float, float, float, float, float],
) -> list[float]:
    if len(coefficients) != 5:
        raise ValueError("biquad coefficients must contain five values")
    b0, b1, b2, a1, a2 = coefficients
    output: list[float] = []
    first_input = 0.0
    second_input = 0.0
    first_output = 0.0
    second_output = 0.0
    for sample in samples:
        input_sample = float(sample)
        if not math.isfinite(input_sample):
            raise ValueError("samples must contain only finite values")
        filtered = b0 * input_sample + b1 * first_input + b2 * second_input
        filtered -= a1 * first_output + a2 * second_output
        output.append(filtered)
        second_input = first_input
        first_input = input_sample
        second_output = first_output
        first_output = filtered
    return output


def lowpass(
    samples: Sequence[float],
    cutoff_frequency: float,
    q: float = 0.707,
) -> list[float]:
    coefficients = _biquad_coefficients("lowpass", cutoff_frequency, q)
    return apply_biquad(samples, coefficients)


def highpass(
    samples: Sequence[float],
    cutoff_frequency: float,
    q: float = 0.707,
) -> list[float]:
    coefficients = _biquad_coefficients("highpass", cutoff_frequency, q)
    return apply_biquad(samples, coefficients)


def bandpass(
    samples: Sequence[float],
    center_frequency: float,
    q: float = 1.0,
) -> list[float]:
    coefficients = _biquad_coefficients("bandpass", center_frequency, q)
    return apply_biquad(samples, coefficients)


def bandpass_noise(
    duration: float,
    center_frequency: float,
    q: float = 1.0,
    seed: int = 0,
) -> list[float]:
    noise = white_noise(duration, seed=seed)
    return bandpass(noise, center_frequency, q=q)


def _create_resonator(period: int, seed: int) -> list[float]:
    generator = random.Random(seed)
    return [generator.uniform(-1.0, 1.0) for _ in range(period)]


def karplus_strong(
    duration: float,
    frequency: float,
    damping: float = 0.996,
    seed: int = 0,
) -> list[float]:
    _validate_frequency(frequency, SAMPLE_RATE)
    if not math.isfinite(damping) or not 0 < damping <= 1:
        raise ValueError("damping must be in the interval (0, 1]")

    period = max(2, round(SAMPLE_RATE / frequency))
    resonator = _create_resonator(period, seed)
    output: list[float] = []
    cursor = 0
    for _ in range(_sample_count(duration)):
        current_sample = resonator[cursor]
        next_index = (cursor + 1) % period
        resonator[cursor] = (current_sample + resonator[next_index]) * 0.5 * damping
        output.append(current_sample)
        cursor = next_index
    return output


def karplus_strong_bar(
    duration: float,
    frequency: float,
    damping: float = 0.997,
    stiffness: float = 0.4,
    seed: int = 0,
) -> list[float]:
    _validate_frequency(frequency, SAMPLE_RATE)
    if not math.isfinite(damping) or not 0 < damping <= 1:
        raise ValueError("damping must be in the interval (0, 1]")
    if not math.isfinite(stiffness) or not -1.0 < stiffness < 1.0:
        raise ValueError("stiffness must be in the interval (-1, 1)")

    period = max(2, round(SAMPLE_RATE / frequency))
    resonator = _create_resonator(period, seed)
    output: list[float] = []
    cursor = 0
    allpass_state = 0.0
    for _ in range(_sample_count(duration)):
        current_sample = resonator[cursor]
        next_index = (cursor + 1) % period
        averaged = (current_sample + resonator[next_index]) * 0.5 * damping
        allpass_out = -stiffness * averaged + allpass_state
        allpass_state = averaged + stiffness * allpass_out
        resonator[cursor] = allpass_out
        output.append(current_sample)
        cursor = next_index
    return output


def frequency_sweep(
    duration: float,
    start_frequency: float,
    end_frequency: float,
    amplitude: float = 1.0,
    method: str = "linear",
    phase: float = 0.0,
) -> list[float]:
    _validate_frequency(start_frequency, SAMPLE_RATE)
    _validate_frequency(end_frequency, SAMPLE_RATE)
    _validate_amplitude(amplitude)
    _validate_phase(phase)
    if method not in {"linear", "exponential"}:
        raise ValueError("method must be 'linear' or 'exponential'")

    total_samples = _sample_count(duration)
    output: list[float] = []
    if method == "linear":
        freq_rate = (end_frequency - start_frequency) / (2.0 * duration)
        for index in range(total_samples):
            t = index / SAMPLE_RATE
            current_phase = (
                2.0 * math.pi * (start_frequency * t + freq_rate * t * t) + phase
            )
            output.append(amplitude * math.sin(current_phase))
    else:
        log_ratio = math.log(end_frequency / start_frequency)
        if abs(log_ratio) < 1e-12:
            return sine(duration, start_frequency, amplitude=amplitude, phase=phase)
        scale_factor = 2.0 * math.pi * start_frequency * duration / log_ratio
        for index in range(total_samples):
            t_ratio = (index / SAMPLE_RATE) / duration
            current_phase = (
                scale_factor
                * (math.pow(end_frequency / start_frequency, t_ratio) - 1.0)
                + phase
            )
            output.append(amplitude * math.sin(current_phase))
    return output


def damped_sine(
    duration: float,
    frequency: float,
    decay_time: float,
    amplitude: float = 1.0,
    phase: float = 0.0,
) -> list[float]:
    _validate_frequency(frequency, SAMPLE_RATE)
    _validate_amplitude(amplitude)
    _validate_phase(phase)
    if not math.isfinite(decay_time) or decay_time <= 0:
        raise ValueError("decay_time must be a positive finite number")

    total_samples = _sample_count(duration)
    output: list[float] = []
    for index in range(total_samples):
        t = index / SAMPLE_RATE
        envelope = math.exp(-t / decay_time)
        output.append(
            amplitude * envelope * math.sin(2.0 * math.pi * frequency * t + phase)
        )
    return output



def _curve_rise(progress: float, curve: str) -> float:
    if curve == "cubic":
        return progress * progress * (3.0 - 2.0 * progress)
    if curve == "exponential":
        curve_end = 1.0 - math.exp(-5.0)
        return (1.0 - math.exp(-5.0 * progress)) / curve_end
    raise ValueError("curve must be 'cubic' or 'exponential'")


def _validate_envelope_settings(settings: EnvelopeSettings, duration: float) -> None:
    stage_values = (
        settings.attack,
        settings.decay,
        settings.sustain,
        settings.release,
    )
    if any(
        not math.isfinite(stage_amount) or stage_amount < 0
        for stage_amount in stage_values
    ):
        raise ValueError("ADSR stage values must be finite and non-negative")
    if settings.curve not in {"cubic", "exponential"}:
        raise ValueError("curve must be 'cubic' or 'exponential'")
    if not 0.0 <= settings.sustain <= 1.0:
        raise ValueError("sustain must be between 0 and 1")
    if (
        settings.attack + settings.decay + settings.release
        > duration + 1.0 / SAMPLE_RATE
    ):
        raise ValueError("attack, decay, and release cannot exceed duration")


def _adsr_level(elapsed: float, settings: EnvelopeSettings, duration: float) -> float:
    if settings.attack > 0 and elapsed < settings.attack:
        return _curve_rise(elapsed / settings.attack, settings.curve)
    decay_end = settings.attack + settings.decay
    if settings.decay > 0 and elapsed < decay_end:
        progress = (elapsed - settings.attack) / settings.decay
        return 1.0 - (1.0 - settings.sustain) * _curve_rise(progress, settings.curve)
    release_start = duration - settings.release
    if settings.release <= 0 or elapsed < release_start:
        return settings.sustain
    release_progress = (elapsed - release_start) / settings.release
    release_progress = min(1.0, max(0.0, release_progress))
    return settings.sustain * (1.0 - _curve_rise(release_progress, settings.curve))


def adsr(duration: float, settings: EnvelopeSettings) -> list[float]:
    _validate_envelope_settings(settings, duration)
    total_samples = _sample_count(duration)
    time_span = max(1, total_samples - 1)
    return [
        _adsr_level(index * duration / time_span, settings, duration)
        for index in range(total_samples)
    ]


def apply_envelope(samples: Sequence[float], envelope: Sequence[float]) -> list[float]:
    if len(samples) != len(envelope):
        raise ValueError("samples and envelope must have equal lengths")
    return [float(sample) * float(level) for sample, level in zip(samples, envelope)]


def mix(*signals: Sequence[float]) -> list[float]:
    if not signals:
        return []
    output_length = max(len(signal) for signal in signals)
    output = [0.0] * output_length
    for signal in signals:
        for index, sample in enumerate(signal):
            output[index] += float(sample)
    return output


def scale(samples: Sequence[float], factor: float) -> list[float]:
    _validate_amplitude(factor)
    return [float(sample) * factor for sample in samples]


def remove_dc_offset(samples: Sequence[float]) -> list[float]:
    if not samples:
        return []
    mean = sum(float(sample) for sample in samples) / len(samples)
    return [float(sample) - mean for sample in samples]


def peak(samples: Sequence[float]) -> float:
    return max((abs(float(sample)) for sample in samples), default=0.0)


def normalize_peak(samples: Sequence[float], target_dbfs: float = -3.0) -> list[float]:
    if not math.isfinite(target_dbfs) or target_dbfs > 0:
        raise ValueError("target_dbfs must be finite and no greater than zero")
    current_peak = peak(samples)
    if current_peak == 0:
        return [float(sample) for sample in samples]
    return [
        float(sample) * db_to_linear(target_dbfs) / current_peak for sample in samples
    ]


def _coerce_channels(
    samples: Sequence[float] | Sequence[Sequence[float]],
) -> list[Sequence[float]]:
    if not samples:
        raise ValueError("samples must not be empty")
    first_sample = samples[0]
    if isinstance(first_sample, Real):
        return [cast(Sequence[float], samples)]
    return [cast(Sequence[float], channel) for channel in samples]


def _validate_channels(channels: Sequence[Sequence[float]]) -> int:
    if len(channels) not in {1, 2}:
        raise ValueError("WAV output must contain one or two channels")
    channel_lengths = {len(channel) for channel in channels}
    if len(channel_lengths) != 1 or 0 in channel_lengths:
        raise ValueError("all WAV channels must have equal non-zero lengths")
    return next(iter(channel_lengths))


def _encode_pcm_frames(
    channels: Sequence[Sequence[float]],
    frame_count: int,
) -> bytearray:
    encoded = bytearray()
    for frame_index in range(frame_count):
        for channel in channels:
            sample = float(channel[frame_index])
            if not math.isfinite(sample):
                raise ValueError("samples must contain only finite values")
            if not -1.0 <= sample <= 1.0:
                raise ValueError("samples must stay within the PCM range")
            encoded.extend(struct.pack("<h", round(sample * MAX_PCM_VALUE)))
    return encoded


def write_pcm_wav(
    path: str | Path,
    samples: Sequence[float] | Sequence[Sequence[float]],
    sample_rate: int = SAMPLE_RATE,
) -> None:
    _validate_sample_rate(sample_rate)
    channels = _coerce_channels(samples)
    frame_count = _validate_channels(channels)
    encoded = _encode_pcm_frames(channels, frame_count)

    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as output:
        output.setnchannels(len(channels))
        output.setsampwidth(BIT_DEPTH // 8)
        output.setframerate(sample_rate)
        output.writeframes(encoded)
