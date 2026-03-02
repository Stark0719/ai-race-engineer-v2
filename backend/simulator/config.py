"""
Simulation Configuration
========================
All tunable parameters extracted from code into a single config module.
This enables reproducibility, A/B testing, and shows engineering discipline.

Compound data can be overridden with telemetry-derived values at runtime.
"""

from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Tyre compound parameters
# ---------------------------------------------------------------------------
# pace_offset: seconds faster(−) or slower(+) than baseline
# deg:         linear degradation rate (sec/lap)
# cliff_onset: lap number where non-linear degradation begins
# cliff_multiplier: quadratic penalty coefficient after cliff onset
#
# Defaults are calibrated against 2023 Bahrain GP telemetry.
# Override at runtime with telemetry-derived values for other circuits.
# ---------------------------------------------------------------------------

COMPOUNDS: dict = {
    "soft": {
        "pace_offset": -0.8,
        "deg": 0.08,
        "cliff_onset": 18,
        "cliff_multiplier": 0.012,
    },
    "medium": {
        "pace_offset": 0.0,
        "deg": 0.03,
        "cliff_onset": 30,
        "cliff_multiplier": 0.008,
    },
    "hard": {
        "pace_offset": 0.5,
        "deg": 0.015,
        "cliff_onset": 42,
        "cliff_multiplier": 0.005,
    },
}


@dataclass
class SimulationConfig:
    """
    Central configuration for the strategy simulator.

    All 'magic numbers' from the original codebase are collected here
    so they can be tuned, logged, and version-controlled.

    Attributes
    ----------
    warmup_laps : int
        Number of laps with warmup penalty after a pit stop.
    warmup_penalty : float
        Seconds added per warmup lap (tyre temperature ramp-up).
    fuel_effect : float
        Seconds per lap gained as fuel burns off (~3kg/lap × ~0.035s/kg).
    deg_noise_range : float
        Half-width of uniform noise applied to degradation rate per MC iteration.
    sc_pit_loss_factor : float
        Multiplier applied to pit loss during safety car (field bunched up).
    min_stint_length : int
        Minimum laps on any compound (regulatory + practical minimum).
    cliff_threshold : float
        Lap-over-lap delta (sec) that triggers cliff detection in telemetry.
    push_threshold : float
        Seconds within best lap to count as a "push lap" for push ratio metric.
    outlier_quantile : float
        Quantile cutoff for removing slow laps (pit in/out, traffic, incidents).
    min_stint_laps_for_features : int
        Minimum usable laps in a stint to compute degradation features.
    warmup_laps_to_discard : int
        Number of laps discarded from stint start before feature computation.
    """

    # Tyre model
    warmup_laps: int = 2
    warmup_penalty: float = 0.7

    # Fuel model
    fuel_effect: float = 0.035

    # Monte Carlo noise
    deg_noise_range: float = 0.005

    # Safety car
    sc_pit_loss_factor: float = 0.4

    # Strategy constraints
    min_stint_length: int = 5

    # Telemetry analysis thresholds
    cliff_threshold: float = 0.25
    push_threshold: float = 0.3
    outlier_quantile: float = 0.90
    min_stint_laps_for_features: int = 8
    warmup_laps_to_discard: int = 2
