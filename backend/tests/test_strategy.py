"""Tests for strategy simulation and Monte Carlo comparison."""

import numpy as np
import pytest
from backend.simulator.config import SimulationConfig, COMPOUNDS
from backend.simulator.strategy import (
    _stint_times,
    recommend_strategy,
    monte_carlo_compare,
    recommend_strategy_with_weather,
)
from backend.simulator.weather import WeatherConfig


@pytest.fixture
def config():
    return SimulationConfig()


class TestStintTimes:
    def test_shape_matches_input(self, config):
        laps = np.arange(1, 21, dtype=float)
        ages = np.arange(1, 21, dtype=float)
        result = _stint_times(laps, ages, "medium", 90.0, config)
        assert result.shape == laps.shape

    def test_ordering_soft_faster_initially(self, config):
        laps = np.array([1.0])
        ages = np.array([1.0])
        soft_time = _stint_times(laps, ages, "soft", 90.0, config)[0]
        hard_time = _stint_times(laps, ages, "hard", 90.0, config)[0]
        assert soft_time < hard_time

    def test_cliff_effect_increases_times(self, config):
        pre_cliff = np.array([17.0])
        post_cliff = np.array([25.0])
        t_pre = _stint_times(np.array([17.0]), pre_cliff, "soft", 90.0, config)[0]
        t_post = _stint_times(np.array([25.0]), post_cliff, "soft", 90.0, config)[0]
        assert t_post > t_pre

    def test_warmup_penalty_applied(self, config):
        lap1 = _stint_times(np.array([1.0]), np.array([1.0]), "medium", 90.0, config)[0]
        lap5 = _stint_times(np.array([5.0]), np.array([5.0]), "medium", 90.0, config)[0]
        # Lap 1 should have warmup penalty; lap 5 age degrades but no warmup
        # The warmup penalty is config.warmup_penalty (0.7) and lap 5 deg is small
        assert lap1 > 90.0  # includes warmup

    def test_fuel_benefit(self, config):
        early = _stint_times(np.array([1.0]), np.array([1.0]), "medium", 90.0, config)[0]
        late = _stint_times(np.array([50.0]), np.array([1.0]), "medium", 90.0, config)[0]
        # Later laps benefit from less fuel (faster), but this gets subtracted
        assert late < early  # fuel benefit makes later laps faster (for same tyre age)


class TestMonteCarloCompare:
    def test_win_rates_sum_to_one(self, config):
        result = monte_carlo_compare(
            iterations=50, total_laps=30, base_lap_time=90.0,
            pit_loss_time=20.0, one_stop_compounds=("medium", "hard"),
            two_stop_compounds=("soft", "medium", "hard"),
            config=config, seed=42,
        )
        assert abs(result["one_stop_win_rate"] + result["two_stop_win_rate"] - 1.0) < 0.01

    def test_determinism_with_seed(self, config):
        kwargs = dict(
            iterations=50, total_laps=30, base_lap_time=90.0,
            pit_loss_time=20.0, one_stop_compounds=("medium", "hard"),
            two_stop_compounds=("soft", "medium", "hard"),
            config=config, seed=123,
        )
        r1 = monte_carlo_compare(**kwargs)
        r2 = monte_carlo_compare(**kwargs)
        assert r1["one_stop_win_rate"] == r2["one_stop_win_rate"]
        assert r1["one_stop_mean_time"] == r2["one_stop_mean_time"]


class TestRecommendStrategy:
    def test_returns_required_keys(self, config):
        result = recommend_strategy(
            iterations=30, total_laps=30, base_lap_time=90.0,
            pit_loss_time=20.0, one_stop_compounds=("medium", "hard"),
            two_stop_compounds=("soft", "medium", "hard"),
            config=config, seed=42,
        )
        assert "recommended" in result
        assert "confidence" in result
        assert "pit_windows" in result
        assert result["recommended"] in ("1-stop", "2-stop")

    def test_confidence_in_range(self, config):
        result = recommend_strategy(
            iterations=50, total_laps=30, base_lap_time=90.0,
            pit_loss_time=20.0, one_stop_compounds=("medium", "hard"),
            two_stop_compounds=("soft", "medium", "hard"),
            config=config, seed=42,
        )
        assert 0.0 <= result["confidence"] <= 1.0

    def test_pit_windows_exist(self, config):
        result = recommend_strategy(
            iterations=30, total_laps=30, base_lap_time=90.0,
            pit_loss_time=20.0, one_stop_compounds=("medium", "hard"),
            two_stop_compounds=("soft", "medium", "hard"),
            config=config, seed=42,
        )
        assert "one_stop" in result["pit_windows"]
        assert "p10" in result["pit_windows"]["one_stop"]
        assert "p50" in result["pit_windows"]["one_stop"]
        assert "p90" in result["pit_windows"]["one_stop"]


class TestRecommendStrategyWithWeather:
    def test_no_rain_delegates_to_standard(self, config):
        weather = WeatherConfig(rain_probability_per_lap=0.0)
        result = recommend_strategy_with_weather(
            iterations=30, total_laps=30, base_lap_time=90.0,
            pit_loss_time=20.0, weather_config=weather,
            config=config, seed=42,
        )
        assert "recommended" in result
        assert result["recommended"] in ("1-stop", "2-stop")

    def test_rain_returns_weather_analysis(self, config):
        weather = WeatherConfig(rain_probability_per_lap=0.3)
        result = recommend_strategy_with_weather(
            iterations=20, total_laps=30, base_lap_time=90.0,
            pit_loss_time=20.0, weather_config=weather,
            config=config, seed=42,
        )
        assert "weather_analysis" in result
        assert "strategy_win_rates" in result

    def test_wet_strategies_evaluated(self, config):
        weather = WeatherConfig(rain_probability_per_lap=0.5)
        result = recommend_strategy_with_weather(
            iterations=20, total_laps=30, base_lap_time=90.0,
            pit_loss_time=20.0, weather_config=weather,
            config=config, seed=42,
        )
        # Should have win rates for multiple strategies
        assert len(result["strategy_win_rates"]) >= 2

    def test_win_rates_sum_near_one(self, config):
        weather = WeatherConfig(rain_probability_per_lap=0.3)
        result = recommend_strategy_with_weather(
            iterations=30, total_laps=30, base_lap_time=90.0,
            pit_loss_time=20.0, weather_config=weather,
            config=config, seed=42,
        )
        total = sum(result["strategy_win_rates"].values())
        assert abs(total - 1.0) < 0.01

    def test_determinism_with_seed(self, config):
        weather = WeatherConfig(rain_probability_per_lap=0.3)
        kwargs = dict(
            iterations=20, total_laps=30, base_lap_time=90.0,
            pit_loss_time=20.0, weather_config=weather,
            config=config, seed=99,
        )
        r1 = recommend_strategy_with_weather(**kwargs)
        r2 = recommend_strategy_with_weather(**kwargs)
        assert r1["recommended"] == r2["recommended"]
