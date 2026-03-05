"""Tests for simulation config and compound data."""

from backend.simulator.config import SimulationConfig, COMPOUNDS


class TestCompounds:
    def test_all_required_keys_present(self):
        required = {"pace_offset", "deg", "cliff_onset", "cliff_multiplier"}
        for name, data in COMPOUNDS.items():
            assert required.issubset(data.keys()), f"{name} missing keys: {required - set(data.keys())}"

    def test_soft_is_fastest(self):
        assert COMPOUNDS["soft"]["pace_offset"] < COMPOUNDS["medium"]["pace_offset"]
        assert COMPOUNDS["medium"]["pace_offset"] < COMPOUNDS["hard"]["pace_offset"]

    def test_hard_has_least_degradation(self):
        assert COMPOUNDS["hard"]["deg"] < COMPOUNDS["medium"]["deg"]
        assert COMPOUNDS["medium"]["deg"] < COMPOUNDS["soft"]["deg"]

    def test_wet_compounds_have_extra_keys(self):
        for name in ("intermediate", "wet"):
            assert "wet_grip_bonus" in COMPOUNDS[name]
            assert "dry_overheat_penalty" in COMPOUNDS[name]

    def test_at_least_five_compounds(self):
        assert len(COMPOUNDS) >= 5


class TestSimulationConfig:
    def test_defaults(self):
        cfg = SimulationConfig()
        assert cfg.tick_rate == 20
        assert cfg.fuel_start_kg == 110.0
        assert cfg.fuel_per_lap_kg == 1.75
        assert cfg.tyre_ambient_temp == 35.0
        assert cfg.tyre_optimal_temp == 95.0
        assert cfg.safety_car_max_speed == 180.0
        assert cfg.ws_max_clients == 50
        assert cfg.chat_max_message_length == 2000
        assert cfg.telemetry_history_cap == 200
