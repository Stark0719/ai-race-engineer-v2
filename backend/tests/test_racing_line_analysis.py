"""Tests for racing line analysis."""

import pytest
from backend.simulator.racing_line_analysis import evaluate_racing_lines, rolling_racing_line_analysis


class TestEvaluateRacingLines:
    def test_returns_five_lines(self, sample_track):
        result = evaluate_racing_lines(
            track=sample_track, telemetry={},
            horizon_laps=5, iterations=50, seed=42,
        )
        assert len(result["lines"]) == 5

    def test_sorted_by_time(self, sample_track):
        result = evaluate_racing_lines(
            track=sample_track, telemetry={},
            horizon_laps=5, iterations=50, seed=42,
        )
        times = [l["mean_horizon_time"] for l in result["lines"]]
        assert times == sorted(times)

    def test_delta_zero_for_best(self, sample_track):
        result = evaluate_racing_lines(
            track=sample_track, telemetry={},
            horizon_laps=5, iterations=50, seed=42,
        )
        assert result["lines"][0]["delta_to_best"] == 0.0

    def test_wear_increases_time(self, sample_track):
        result_fresh = evaluate_racing_lines(
            track=sample_track, telemetry={"tyre_wear_pct": 0.0},
            horizon_laps=5, iterations=100, seed=42,
        )
        result_worn = evaluate_racing_lines(
            track=sample_track, telemetry={"tyre_wear_pct": 0.5},
            horizon_laps=5, iterations=100, seed=42,
        )
        # Worn tyres should generally produce slower lap times
        best_fresh = result_fresh["lines"][0]["mean_horizon_time"]
        best_worn = result_worn["lines"][0]["mean_horizon_time"]
        assert best_worn >= best_fresh

    def test_determinism(self, sample_track):
        kwargs = dict(
            track=sample_track, telemetry={},
            horizon_laps=5, iterations=50, seed=42,
        )
        r1 = evaluate_racing_lines(**kwargs)
        r2 = evaluate_racing_lines(**kwargs)
        assert r1["lines"][0]["mean_horizon_time"] == r2["lines"][0]["mean_horizon_time"]

    def test_recommended_line_exists(self, sample_track):
        result = evaluate_racing_lines(
            track=sample_track, telemetry={},
            horizon_laps=5, iterations=50, seed=42,
        )
        assert "recommended_line" in result
        assert result["recommended_line"] in (
            "conservative", "balanced", "late_apex", "early_apex", "aggressive"
        )


class TestRollingRacingLineAnalysis:
    def test_rolling_window_returns_results(self, sample_track):
        result = rolling_racing_line_analysis(
            track=sample_track, telemetry={},
            window_laps=5, horizon_laps=3,
            iterations=30, seed=42,
        )
        assert "rollout" in result
        assert len(result["rollout"]) > 0

    def test_rolling_result_has_recommended_line(self, sample_track):
        result = rolling_racing_line_analysis(
            track=sample_track, telemetry={},
            window_laps=5, horizon_laps=3,
            iterations=30, seed=42,
        )
        for entry in result["rollout"]:
            assert "recommended_line" in entry
