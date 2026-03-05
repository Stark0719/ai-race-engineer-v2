"""
Shared test fixtures for backend tests.
"""

import math
import pytest
from backend.simulator.config import SimulationConfig, COMPOUNDS
from backend.simulator.tracks import TrackProfile, TRACKS


@pytest.fixture
def config():
    """Default SimulationConfig."""
    return SimulationConfig()


@pytest.fixture
def sample_track():
    """Simple oval track for unit testing."""
    n = 100
    radius = 500
    waypoints = []
    for i in range(n):
        angle = 2 * math.pi * i / n
        x = radius * math.cos(angle)
        y = radius * math.sin(angle)
        speed = 250 + 50 * math.cos(2 * angle)  # varying speed
        heading = angle + math.pi / 2
        waypoints.append([x, y, speed, heading])
    # Close the loop
    waypoints.append(waypoints[0][:])

    return TrackProfile(
        key="test_oval",
        name="Test Oval",
        country="Test",
        total_laps=30,
        pit_loss_sec=20.0,
        base_lap_time_sec=90.0,
        safety_car_probability=0.2,
        circuit_length_m=2 * math.pi * radius,
        sector_boundaries=[0.0, 0.33, 0.66, 1.0],
        waypoints=waypoints,
        corners=[
            {"index": 25, "min_speed": 150},
            {"index": 75, "min_speed": 120},
        ],
        bounds={"x_min": -600, "x_max": 600, "y_min": -600, "y_max": 600},
    )


@pytest.fixture
def bahrain_track():
    """Real Bahrain track if available."""
    if "bahrain" in TRACKS:
        return TRACKS["bahrain"]
    pytest.skip("Bahrain track not loaded")


@pytest.fixture
def sample_telemetry_frame():
    """Sample telemetry data dict."""
    return {
        "timestamp": 1234567890.0,
        "lap_number": 15,
        "lap_fraction": 0.5,
        "sector": 2,
        "speed_kph": 280.0,
        "throttle": 0.85,
        "brake": 0.0,
        "gear": 7,
        "rpm": 12000.0,
        "drs": True,
        "fuel_remaining_kg": 80.0,
        "tyre_compound": "medium",
        "tyre_age_laps": 10,
        "tyre_temp_c": 95.0,
        "tyre_wear_pct": 0.15,
        "current_lap_time": 45.0,
        "last_lap_time": 92.5,
        "sector_1_time": 28.5,
        "sector_2_time": 33.2,
        "sector_3_time": 30.8,
        "x": 100.0,
        "y": 200.0,
        "heading": 1.5,
        "gap_to_leader": 3.5,
        "safety_car": False,
        "in_pit": False,
        "total_race_time": 1400.0,
        "position": 3,
    }
