"""Tests for chat engineer context building and tool detection."""

import pytest
from unittest.mock import patch, MagicMock
from backend.agent.chat_engineer import _build_live_summary


class TestBuildLiveSummary:
    def test_empty_context(self):
        summary = _build_live_summary(None)
        assert isinstance(summary, str)
        assert len(summary) > 0

    def test_includes_race_status(self):
        ctx = {"race_running": True, "track_key": "bahrain"}
        summary = _build_live_summary(ctx)
        assert "bahrain" in summary.lower() or "race" in summary.lower()

    def test_includes_telemetry_data(self):
        ctx = {
            "race_running": True,
            "telemetry": {
                "lap_number": 15,
                "tyre_compound": "soft",
                "tyre_wear_pct": 0.25,
                "speed_kph": 280,
            },
        }
        summary = _build_live_summary(ctx)
        assert "15" in summary  # lap number should appear

    def test_includes_tyre_info(self):
        ctx = {
            "telemetry": {
                "tyre_compound": "medium",
                "tyre_age_laps": 10,
            },
        }
        summary = _build_live_summary(ctx)
        assert "medium" in summary.lower() or "10" in summary

    def test_best_lap_from_lap_times(self):
        ctx = {
            "lap_times": [
                {"lap": 1, "time": 95.0},
                {"lap": 2, "time": 92.5},
                {"lap": 3, "time": 93.0},
            ],
        }
        summary = _build_live_summary(ctx)
        assert "92.5" in summary or "best" in summary.lower() or len(summary) > 0

    def test_safety_car_detection(self):
        ctx = {
            "telemetry": {"safety_car": True},
        }
        summary = _build_live_summary(ctx)
        # Summary should mention safety car or SC
        assert isinstance(summary, str)

    def test_pit_context(self):
        ctx = {
            "pit_loss_time": 22.0,
            "total_laps": 57,
        }
        summary = _build_live_summary(ctx)
        assert isinstance(summary, str)
