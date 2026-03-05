"""
Tyre Degradation ML Model
==========================
Builds a driver×compound lookup table from historical stint data.
Falls back to COMPOUNDS defaults when data is unavailable.

Usage:
    model = get_tyre_model()
    prediction = model.predict("VER", "soft")
    compounds = model.get_calibrated_compounds("VER")
"""

from __future__ import annotations

import logging
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pandas as pd

from backend.simulator.config import COMPOUNDS

logger = logging.getLogger(__name__)

_STINT_FEATURES_PATH = Path("data/stint_features.parquet")
_STINTS_PATH = Path("data/stints.parquet")

# Compound name normalization
_COMPOUND_MAP = {
    "SOFT": "soft",
    "MEDIUM": "medium",
    "HARD": "hard",
    "INTERMEDIATE": "intermediate",
    "WET": "wet",
}


@dataclass
class TyrePrediction:
    deg_rate: float
    cliff_onset: float
    cliff_multiplier: float
    confidence: float  # 0.0 = no data (using defaults), 1.0 = high confidence


class TyreDegradationModel:
    """Lookup-table model for per-driver, per-compound tyre degradation."""

    def __init__(self):
        self._lookup: dict[tuple[str, str], TyrePrediction] = {}
        self._trained = False

    def train(self) -> None:
        """Build lookup table from historical data."""
        if not _STINT_FEATURES_PATH.exists():
            logger.warning("Tyre model: stint_features.parquet not found, using defaults")
            return

        try:
            features = pd.read_parquet(_STINT_FEATURES_PATH)
        except Exception as e:
            logger.warning(f"Tyre model: failed to load data: {e}")
            return

        # Normalize compound names
        compound_col = "compound" if "compound" in features.columns else "Compound"
        if compound_col not in features.columns:
            logger.warning("Tyre model: no compound column found")
            return

        features = features.copy()
        features["_compound_norm"] = (
            features[compound_col].astype(str).str.upper().map(_COMPOUND_MAP)
        )
        features = features.dropna(subset=["_compound_norm"])

        deg_col = "deg_slope_sec_per_lap"
        if deg_col not in features.columns:
            logger.warning("Tyre model: no deg_slope_sec_per_lap column")
            return

        cliff_col = "cliff_lap" if "cliff_lap" in features.columns else None

        grouped = features.groupby(["Driver", "_compound_norm"])
        count = 0
        for (driver, compound), group in grouped:
            if len(group) < 1:
                continue

            deg_rate = float(group[deg_col].mean())
            deg_rate = max(0.001, min(0.25, deg_rate))

            cliff_onset = float(group[cliff_col].mean()) if cliff_col and not group[cliff_col].isna().all() else None
            if cliff_onset is None or pd.isna(cliff_onset):
                default = COMPOUNDS.get(compound, {})
                cliff_onset = float(default.get("cliff_onset", 30))

            default_comp = COMPOUNDS.get(compound, {})
            cliff_multiplier = float(default_comp.get("cliff_multiplier", 0.008))

            n_stints = len(group)
            confidence = min(1.0, n_stints / 5.0)

            self._lookup[(driver, compound)] = TyrePrediction(
                deg_rate=deg_rate,
                cliff_onset=cliff_onset,
                cliff_multiplier=cliff_multiplier,
                confidence=confidence,
            )
            count += 1

        self._trained = True
        logger.info(f"Tyre model trained with {count} driver-compound combos")

    def predict(self, driver: str, compound: str) -> TyrePrediction:
        """Get degradation prediction. Falls back to defaults if no data."""
        key = (driver, compound.lower() if compound else compound)
        if key in self._lookup:
            return self._lookup[key]

        default = COMPOUNDS.get(compound, COMPOUNDS.get("medium", {}))
        return TyrePrediction(
            deg_rate=float(default.get("deg", 0.03)),
            cliff_onset=float(default.get("cliff_onset", 30)),
            cliff_multiplier=float(default.get("cliff_multiplier", 0.008)),
            confidence=0.0,
        )

    def get_calibrated_compounds(self, driver: str) -> dict:
        """Return COMPOUNDS-compatible dict with ML-predicted rates for a driver."""
        compounds = deepcopy(COMPOUNDS)
        for comp_name in list(compounds.keys()):
            pred = self.predict(driver, comp_name)
            if pred.confidence > 0:
                compounds[comp_name]["deg"] = pred.deg_rate
                if pred.cliff_onset:
                    compounds[comp_name]["cliff_onset"] = pred.cliff_onset
        return compounds


_singleton: Optional[TyreDegradationModel] = None


def get_tyre_model() -> TyreDegradationModel:
    """Lazy singleton — trains once on first call."""
    global _singleton
    if _singleton is None:
        _singleton = TyreDegradationModel()
        _singleton.train()
    return _singleton
