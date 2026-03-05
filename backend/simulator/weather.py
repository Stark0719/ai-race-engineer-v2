"""
Weather Model
=============
Markov-chain weather simulation with track temperature, grip, and
degradation-rate effects. Default config produces dry weather with
no rain transitions (backward compatible).
"""

from __future__ import annotations

import enum
import random
from dataclasses import dataclass, field
from typing import Optional


class WeatherState(enum.Enum):
    DRY = "dry"
    LIGHT_RAIN = "light_rain"
    HEAVY_RAIN = "heavy_rain"
    DRYING = "drying"


# Default Markov transition matrix: rows = current state, cols = next state
# Order: DRY, LIGHT_RAIN, HEAVY_RAIN, DRYING
_DEFAULT_TRANSITION_MATRIX = [
    [0.85, 0.10, 0.02, 0.03],   # from DRY
    [0.10, 0.55, 0.25, 0.10],   # from LIGHT_RAIN
    [0.02, 0.15, 0.65, 0.18],   # from HEAVY_RAIN
    [0.30, 0.15, 0.05, 0.50],   # from DRYING
]


@dataclass
class WeatherConfig:
    initial_state: WeatherState = WeatherState.DRY
    ambient_temp_c: float = 28.0
    rain_probability_per_lap: float = 0.0  # 0 = backward compat (always dry)
    transition_matrix: list[list[float]] = field(
        default_factory=lambda: [row[:] for row in _DEFAULT_TRANSITION_MATRIX]
    )
    wind_speed_base_kph: float = 10.0
    wind_gust_std_kph: float = 5.0
    track_temp_base_c: float = 40.0
    track_temp_rubber_in_per_lap: float = 0.15
    rain_cooling_factor: float = 8.0
    rain_sc_probability_multiplier: float = 2.5


@dataclass
class WeatherSnapshot:
    state: WeatherState
    rain_intensity: float          # 0.0 (dry) to 1.0 (heavy)
    track_temp_c: float
    grip_multiplier: float         # 1.0 = normal, <1.0 = reduced grip
    deg_rate_multiplier: float     # 1.0 = normal, >1.0 = faster degradation
    optimal_temp_shift: float      # shift to tyre optimal temp
    sc_probability_multiplier: float
    wind_speed_kph: float = 10.0


_STATE_ORDER = [
    WeatherState.DRY,
    WeatherState.LIGHT_RAIN,
    WeatherState.HEAVY_RAIN,
    WeatherState.DRYING,
]


class WeatherModel:
    """Lap-by-lap weather simulation using Markov chain transitions."""

    def __init__(self, config: Optional[WeatherConfig] = None, seed: Optional[int] = None):
        self.config = config or WeatherConfig()
        self.rng = random.Random(seed)
        self.state = self.config.initial_state
        self.lap = 0
        self.rubber_in_laps = 0  # laps of rubber build-up (resets on rain)

    def _transition(self) -> WeatherState:
        """Markov state transition."""
        if self.config.rain_probability_per_lap <= 0.0:
            return WeatherState.DRY

        idx = _STATE_ORDER.index(self.state)
        row = self.config.transition_matrix[idx]
        r = self.rng.random()
        cumulative = 0.0
        for i, prob in enumerate(row):
            cumulative += prob
            if r <= cumulative:
                return _STATE_ORDER[i]
        return _STATE_ORDER[-1]

    def _rain_intensity(self, state: WeatherState) -> float:
        if state == WeatherState.DRY:
            return 0.0
        elif state == WeatherState.LIGHT_RAIN:
            return 0.2 + self.rng.uniform(0, 0.2)
        elif state == WeatherState.HEAVY_RAIN:
            return 0.6 + self.rng.uniform(0, 0.4)
        elif state == WeatherState.DRYING:
            return 0.05 + self.rng.uniform(0, 0.1)
        return 0.0

    def _track_temp(self, rain_intensity: float) -> float:
        base = self.config.track_temp_base_c
        rubber_bonus = self.rubber_in_laps * self.config.track_temp_rubber_in_per_lap
        rain_cooling = rain_intensity * self.config.rain_cooling_factor
        return max(self.config.ambient_temp_c, base + rubber_bonus - rain_cooling)

    def _grip_multiplier(self, rain_intensity: float) -> float:
        return max(0.4, 1.0 - rain_intensity * 0.6)

    def _deg_rate_multiplier(self, rain_intensity: float) -> float:
        if rain_intensity < 0.1:
            return 1.0
        return 1.0 + rain_intensity * 0.3

    def _wind_speed(self) -> float:
        return max(0.0, self.config.wind_speed_base_kph +
                   self.rng.gauss(0, self.config.wind_gust_std_kph))

    def advance_lap(self) -> WeatherSnapshot:
        """Advance one lap and return the weather snapshot."""
        self.lap += 1

        # Decide if we even attempt a weather transition
        if self.config.rain_probability_per_lap > 0.0:
            if self.state == WeatherState.DRY:
                if self.rng.random() < self.config.rain_probability_per_lap:
                    self.state = self._transition()
            else:
                self.state = self._transition()
        # else: stay DRY forever

        rain_intensity = self._rain_intensity(self.state)

        # Rubber build-up resets in significant rain
        if rain_intensity > 0.3:
            self.rubber_in_laps = max(0, self.rubber_in_laps - 3)
        else:
            self.rubber_in_laps += 1

        track_temp = self._track_temp(rain_intensity)
        grip = self._grip_multiplier(rain_intensity)
        deg_mult = self._deg_rate_multiplier(rain_intensity)
        wind = self._wind_speed()

        sc_mult = 1.0
        if rain_intensity > 0.3:
            sc_mult = self.config.rain_sc_probability_multiplier

        optimal_temp_shift = -rain_intensity * 10.0  # cooler optimal in rain

        return WeatherSnapshot(
            state=self.state,
            rain_intensity=round(rain_intensity, 3),
            track_temp_c=round(track_temp, 1),
            grip_multiplier=round(grip, 3),
            deg_rate_multiplier=round(deg_mult, 3),
            optimal_temp_shift=round(optimal_temp_shift, 1),
            sc_probability_multiplier=round(sc_mult, 2),
            wind_speed_kph=round(wind, 1),
        )

    def generate_timeline(self, total_laps: int) -> list[WeatherSnapshot]:
        """Generate a full race weather timeline."""
        return [self.advance_lap() for _ in range(total_laps)]
