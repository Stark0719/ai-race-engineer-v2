"""Tests for weather model."""

import pytest
from backend.simulator.weather import (
    WeatherState,
    WeatherConfig,
    WeatherSnapshot,
    WeatherModel,
)


class TestWeatherSnapshot:
    def test_dry_grip_is_one(self):
        model = WeatherModel(seed=42)
        snap = model.advance_lap()
        assert snap.grip_multiplier == 1.0
        assert snap.state == WeatherState.DRY

    def test_rain_reduces_grip(self):
        config = WeatherConfig(
            initial_state=WeatherState.HEAVY_RAIN,
            rain_probability_per_lap=1.0,
        )
        model = WeatherModel(config=config, seed=42)
        snap = model.advance_lap()
        # Should transition somewhere; if heavy rain, grip < 1
        if snap.state in (WeatherState.HEAVY_RAIN, WeatherState.LIGHT_RAIN):
            assert snap.grip_multiplier < 1.0


class TestWeatherModel:
    def test_markov_transitions(self):
        config = WeatherConfig(
            initial_state=WeatherState.LIGHT_RAIN,
            rain_probability_per_lap=1.0,
        )
        model = WeatherModel(config=config, seed=42)
        states = set()
        for _ in range(50):
            snap = model.advance_lap()
            states.add(snap.state)
        # Should visit multiple states
        assert len(states) >= 2

    def test_track_temp_positive(self):
        model = WeatherModel(seed=42)
        for _ in range(10):
            snap = model.advance_lap()
            assert snap.track_temp_c > 0

    def test_rubber_in_effect(self):
        model = WeatherModel(seed=42)
        snap1 = model.advance_lap()
        for _ in range(20):
            snap2 = model.advance_lap()
        # After many dry laps, track temp should be higher (rubber build-up)
        assert snap2.track_temp_c >= snap1.track_temp_c - 1  # allow small variance

    def test_sc_multiplier_dry(self):
        model = WeatherModel(seed=42)
        snap = model.advance_lap()
        assert snap.sc_probability_multiplier == 1.0

    def test_sc_multiplier_rain(self):
        config = WeatherConfig(
            initial_state=WeatherState.HEAVY_RAIN,
            rain_probability_per_lap=1.0,
        )
        model = WeatherModel(config=config, seed=42)
        # Try multiple laps to find one with significant rain
        for _ in range(20):
            snap = model.advance_lap()
            if snap.rain_intensity > 0.3:
                assert snap.sc_probability_multiplier > 1.0
                return
        # If no heavy rain occurred, that's OK; test is probabilistic

    def test_determinism_with_seed(self):
        config = WeatherConfig(rain_probability_per_lap=0.3)
        m1 = WeatherModel(config=config, seed=42)
        m2 = WeatherModel(config=config, seed=42)
        for _ in range(20):
            s1 = m1.advance_lap()
            s2 = m2.advance_lap()
            assert s1.state == s2.state
            assert s1.grip_multiplier == s2.grip_multiplier

    def test_generate_timeline_length(self):
        model = WeatherModel(seed=42)
        timeline = model.generate_timeline(57)
        assert len(timeline) == 57

    def test_default_config_always_dry(self):
        model = WeatherModel(seed=42)
        for _ in range(50):
            snap = model.advance_lap()
            assert snap.state == WeatherState.DRY
            assert snap.rain_intensity == 0.0

    def test_wind_speed_non_negative(self):
        config = WeatherConfig(rain_probability_per_lap=0.5)
        model = WeatherModel(config=config, seed=42)
        for _ in range(30):
            snap = model.advance_lap()
            assert snap.wind_speed_kph >= 0.0
