"""Tests for LiveCarSimulator."""

import pytest
from backend.simulator.config import SimulationConfig, COMPOUNDS
from backend.simulator.tracks import TRACKS
from backend.live.car_simulator import LiveCarSimulator


@pytest.fixture
def simulator():
    track_key = next(iter(TRACKS.keys()))
    return LiveCarSimulator(track_key, compound="medium", config=SimulationConfig())


class TestLiveCarSimulator:
    def test_tick_advances_fraction(self, simulator):
        initial = simulator.lap_fraction
        simulator.tick(0.5, real_dt=0.05)
        assert simulator.lap_fraction > initial or simulator.lap_number > 1

    def test_lap_increment(self, simulator):
        # Tick enough to complete at least one lap
        for _ in range(200):
            simulator.tick(1.0, real_dt=0.05)
        assert simulator.lap_number > 1

    def test_fuel_burns(self, simulator):
        initial_fuel = simulator.fuel_kg
        for _ in range(200):
            simulator.tick(1.0, real_dt=0.05)
        assert simulator.fuel_kg < initial_fuel

    def test_tyre_wear_increases(self, simulator):
        for _ in range(200):
            simulator.tick(1.0, real_dt=0.05)
        assert simulator.tyre_wear > 0

    def test_pit_stop_resets_tyres(self, simulator):
        for _ in range(100):
            simulator.tick(1.0, real_dt=0.05)
        simulator.pit_stop("hard")
        assert simulator.compound == "hard"
        assert simulator.tyre_age_laps == 0
        assert simulator.tyre_wear == 0.0

    def test_safety_car_caps_speed(self, simulator):
        simulator.safety_car = True
        speed = simulator._compute_speed(0.5)
        assert speed <= simulator.config.safety_car_max_speed + 10  # small tolerance for noise

    def test_sub_stepping_prevents_overshoot(self, simulator):
        # Large dt should not cause lap_fraction > 1
        simulator.tick(10.0, real_dt=0.05)
        assert 0.0 <= simulator.lap_fraction <= 1.0

    def test_generate_frame_returns_telemetry(self, simulator):
        frame = simulator.generate_frame()
        assert hasattr(frame, 'speed_kph')
        assert hasattr(frame, 'x')
        assert hasattr(frame, 'y')

    def test_fuel_uses_config_values(self, simulator):
        assert simulator.fuel_kg == simulator.config.fuel_start_kg
        assert simulator.fuel_per_lap_kg == simulator.config.fuel_per_lap_kg

    def test_is_race_finished(self, simulator):
        assert not simulator.is_race_finished()
        simulator.lap_number = simulator.track.total_laps + 1
        assert simulator.is_race_finished()

    def test_invalid_compound_raises(self, simulator):
        with pytest.raises(ValueError):
            simulator.pit_stop("ultrasoft")
