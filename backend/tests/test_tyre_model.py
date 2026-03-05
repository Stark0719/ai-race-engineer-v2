"""Tests for tyre degradation ML model."""

import pytest
from backend.simulator.tyre_model import (
    TyrePrediction,
    TyreDegradationModel,
    get_tyre_model,
)
from backend.simulator.config import COMPOUNDS


class TestTyreDegradationModel:
    def test_fallback_to_defaults(self):
        model = TyreDegradationModel()
        # Without training, predict should fall back to COMPOUNDS defaults
        pred = model.predict("UNKNOWN_DRIVER", "medium")
        assert pred.deg_rate == COMPOUNDS["medium"]["deg"]
        assert pred.confidence == 0.0

    def test_prediction_dataclass(self):
        pred = TyrePrediction(
            deg_rate=0.05,
            cliff_onset=25.0,
            cliff_multiplier=0.01,
            confidence=0.8,
        )
        assert pred.deg_rate == 0.05
        assert pred.confidence == 0.8

    def test_confidence_zero_for_unknown(self):
        model = get_tyre_model()
        pred = model.predict("ZZZZZ", "soft")
        assert pred.confidence == 0.0

    def test_deg_rate_in_bounds(self):
        model = get_tyre_model()
        # Test a known driver if available
        for compound in ("soft", "medium", "hard"):
            pred = model.predict("VER", compound)
            assert 0.001 <= pred.deg_rate <= 0.25

    def test_calibrated_compounds_structure(self):
        model = get_tyre_model()
        compounds = model.get_calibrated_compounds("VER")
        assert isinstance(compounds, dict)
        for name in ("soft", "medium", "hard"):
            assert name in compounds
            assert "deg" in compounds[name]
            assert "pace_offset" in compounds[name]
            assert "cliff_onset" in compounds[name]
