"""
Racing Line Analytics
=====================
Evaluate multiple racing-line styles against current race telemetry and
return pace/risk trade-offs for short-horizon decision support.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import numpy as np

from backend.simulator.tracks import TrackProfile


@dataclass(frozen=True)
class LineProfile:
    key: str
    label: str
    corner_speed_gain: float
    wear_per_lap: float
    thermal_stress: float
    error_base: float


LINE_PROFILES: tuple[LineProfile, ...] = (
    LineProfile("conservative", "Conservative", corner_speed_gain=-0.002, wear_per_lap=0.018, thermal_stress=0.90, error_base=0.0025),
    LineProfile("balanced", "Balanced", corner_speed_gain=0.000, wear_per_lap=0.022, thermal_stress=1.00, error_base=0.0040),
    LineProfile("late_apex", "Late Apex", corner_speed_gain=0.003, wear_per_lap=0.024, thermal_stress=1.04, error_base=0.0050),
    LineProfile("early_apex", "Early Apex", corner_speed_gain=0.001, wear_per_lap=0.025, thermal_stress=1.06, error_base=0.0065),
    LineProfile("aggressive", "Aggressive", corner_speed_gain=0.006, wear_per_lap=0.029, thermal_stress=1.12, error_base=0.0095),
)


def _temp_penalty(temp_c: float) -> float:
    # Peak tyre performance near ~95C. Penalize larger deviations.
    diff = abs(temp_c - 95.0)
    return 0.0 if diff <= 12 else (diff - 12) * 0.012


def _line_simulation(
    line: LineProfile,
    track: TrackProfile,
    tyre_wear_start: float,
    tyre_temp_c: float,
    safety_car: bool,
    horizon_laps: int,
    iterations: int,
    rng: np.random.Generator,
) -> dict:
    base = float(track.base_lap_time_sec)
    corner_component = base * 0.32
    straight_component = base - corner_component
    sc_multiplier = 0.35 if safety_car else 1.0

    total_times = np.zeros(iterations)
    incident_counts = np.zeros(iterations, dtype=int)

    for i in range(iterations):
        wear = float(max(0.0, tyre_wear_start))
        temp = float(tyre_temp_c)
        race_time = 0.0
        incidents = 0

        for _ in range(horizon_laps):
            corner_gain = (line.corner_speed_gain + rng.normal(0.0, 0.0018)) * sc_multiplier
            corner_time = corner_component * (1.0 - corner_gain)
            straight_time = straight_component + rng.normal(0.0, 0.035)
            wear += max(0.0, line.wear_per_lap + rng.normal(0.0, 0.003))
            temp += (line.thermal_stress - 1.0) * 5.0 + rng.normal(0.0, 0.8)

            wear_pen = max(0.0, (wear - 0.58) * 2.5)
            temp_pen = _temp_penalty(temp)
            lap = corner_time + straight_time + wear_pen + temp_pen

            error_prob = line.error_base + max(0.0, wear - 0.65) * 0.045 + max(0.0, abs(temp - 95.0) - 15) * 0.0015
            if rng.random() < error_prob:
                lap += float(rng.uniform(0.25, 1.7))
                incidents += 1

            race_time += lap

        total_times[i] = race_time
        incident_counts[i] = incidents

    return {
        "line": line.key,
        "label": line.label,
        "mean_horizon_time": float(np.mean(total_times)),
        "std_horizon_time": float(np.std(total_times)),
        "p10_horizon_time": float(np.percentile(total_times, 10)),
        "p90_horizon_time": float(np.percentile(total_times, 90)),
        "incident_rate": float(np.mean(incident_counts > 0)),
        "mean_incidents": float(np.mean(incident_counts)),
    }


def evaluate_racing_lines(
    track: TrackProfile,
    telemetry: Optional[dict],
    horizon_laps: int = 5,
    iterations: int = 400,
    seed: Optional[int] = None,
) -> dict:
    telemetry = telemetry or {}
    tyre_wear = float(telemetry.get("tyre_wear_pct", 0.25))
    tyre_temp = float(telemetry.get("tyre_temp_c", 92.0))
    safety_car = bool(telemetry.get("safety_car", False))

    rng = np.random.default_rng(seed)
    sims = [
        _line_simulation(
            line=line,
            track=track,
            tyre_wear_start=tyre_wear,
            tyre_temp_c=tyre_temp,
            safety_car=safety_car,
            horizon_laps=horizon_laps,
            iterations=iterations,
            rng=rng,
        )
        for line in LINE_PROFILES
    ]

    sims.sort(key=lambda x: x["mean_horizon_time"])
    best = sims[0]
    for item in sims:
        item["delta_to_best"] = round(item["mean_horizon_time"] - best["mean_horizon_time"], 3)

    return {
        "track": track.key,
        "horizon_laps": horizon_laps,
        "iterations": iterations,
        "telemetry_context": {
            "tyre_wear_pct": round(tyre_wear, 3),
            "tyre_temp_c": round(tyre_temp, 1),
            "safety_car": safety_car,
        },
        "recommended_line": best["line"],
        "recommended_label": best["label"],
        "lines": sims,
    }


def rolling_racing_line_analysis(
    track: TrackProfile,
    telemetry: Optional[dict],
    window_laps: int = 8,
    horizon_laps: int = 4,
    iterations: int = 250,
    seed: Optional[int] = None,
) -> dict:
    """
    Evaluate best racing-line evolution over upcoming laps.

    For each future lap index in the window, telemetry context is projected
    (wear increase, temperature drift), then line analytics are re-run.
    """
    telemetry = telemetry or {}
    start_lap = int(telemetry.get("lap_number", 1))
    base_wear = float(telemetry.get("tyre_wear_pct", 0.22))
    base_temp = float(telemetry.get("tyre_temp_c", 92.0))
    safety_car = bool(telemetry.get("safety_car", False))

    rows = []
    rng = np.random.default_rng(seed)
    for i in range(window_laps):
        lap = start_lap + i
        projected_wear = min(1.0, base_wear + i * (0.018 + 0.01 * float(rng.random())))
        projected_temp = base_temp + (2.0 if i < 2 else 0.0) + float(rng.normal(0.0, 1.2))

        snapshot = evaluate_racing_lines(
            track=track,
            telemetry={
                "tyre_wear_pct": projected_wear,
                "tyre_temp_c": projected_temp,
                "safety_car": safety_car,
            },
            horizon_laps=horizon_laps,
            iterations=iterations,
            seed=int(rng.integers(0, 2_000_000_000)),
        )

        rows.append({
            "lap": lap,
            "recommended_line": snapshot["recommended_line"],
            "recommended_label": snapshot["recommended_label"],
            "best_mean_horizon_time": round(snapshot["lines"][0]["mean_horizon_time"], 3),
            "second_best_delta": round(snapshot["lines"][1]["delta_to_best"], 3) if len(snapshot["lines"]) > 1 else 0.0,
            "projected_wear_pct": round(projected_wear, 3),
            "projected_temp_c": round(projected_temp, 2),
        })

    return {
        "track": track.key,
        "start_lap": start_lap,
        "window_laps": window_laps,
        "horizon_laps": horizon_laps,
        "iterations": iterations,
        "rollout": rows,
    }
