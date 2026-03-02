"""
Race Strategy Simulator
=======================
Monte Carlo strategy engine with:
- Non-linear tyre model (linear + cliff)
- Fuel-burn pace effect across race laps
- Safety-car dependent pit-loss reduction by timing window
- Stochastic pit-loss and compound pace/degradation perturbations
"""

from __future__ import annotations

from typing import Optional
import numpy as np

from backend.simulator.config import COMPOUNDS, SimulationConfig


def _stint_times(
    race_laps: np.ndarray,
    tyre_ages: np.ndarray,
    compound: str,
    base_lap_time: float,
    config: SimulationConfig,
    deg_noise: float = 0.0,
    pace_noise: float = 0.0,
    compounds: dict = COMPOUNDS,
) -> np.ndarray:
    """Vectorized lap-time model for one stint over explicit race laps."""
    c = compounds[compound]
    deg_rate = max(0.0, c["deg"] + deg_noise)

    degradation = deg_rate * tyre_ages
    cliff_onset = c.get("cliff_onset", 999)
    cliff_mult = c.get("cliff_multiplier", 0.0)
    degradation = degradation + cliff_mult * np.maximum(0.0, tyre_ages - cliff_onset) ** 2

    warmup = np.where(tyre_ages <= config.warmup_laps, config.warmup_penalty, 0.0)
    fuel_benefit = config.fuel_effect * np.maximum(0.0, race_laps - 1)

    return base_lap_time + c["pace_offset"] + pace_noise + degradation + warmup - fuel_benefit


def _effective_pit_loss(
    pit_lap: int,
    total_laps: int,
    base_pit_loss: float,
    sc_lap: Optional[int],
    config: SimulationConfig,
    traffic_scale: float,
) -> float:
    """
    Compute pit-loss for a specific stop timing.

    Safety car benefit is strongest when pit stop is near SC deployment lap.
    Traffic penalty peaks around race mid-point.
    """
    if sc_lap is None:
        sc_factor = 1.0
    else:
        dist = abs(pit_lap - sc_lap)
        if dist <= 2:
            sc_factor = config.sc_pit_loss_factor
        elif dist <= 6:
            sc_factor = (1.0 + config.sc_pit_loss_factor) * 0.5
        else:
            sc_factor = 1.0

    mid = total_laps * 0.45
    traffic_bump = traffic_scale * np.exp(-((pit_lap - mid) ** 2) / (2 * 8.0**2))

    return float(max(8.0, base_pit_loss * sc_factor + traffic_bump))


def _scenario_noises(
    rng: np.random.Generator,
    compounds: dict,
    config: SimulationConfig,
) -> tuple[dict, dict]:
    """Sample per-scenario compound pace/degradation perturbations."""
    deg_noise = {
        name: float(rng.uniform(-config.deg_noise_range, config.deg_noise_range))
        for name in compounds
    }
    pace_noise = {
        name: float(rng.normal(0.0, 0.06))
        for name in compounds
    }
    return deg_noise, pace_noise


def simulate_one_stop(
    total_laps: int,
    base_lap_time: float,
    pit_loss_time: float,
    compound_1: str,
    compound_2: str,
    config: SimulationConfig,
    deg_noise: float = 0.0,
    compounds: dict = COMPOUNDS,
    sc_lap: Optional[int] = None,
    traffic_scale: float = 0.0,
    pace_noise_1: float = 0.0,
    pace_noise_2: float = 0.0,
) -> tuple[int, float]:
    min_stint = config.min_stint_length
    best_time = np.inf
    best_pit = min_stint

    for pit_lap in range(min_stint, total_laps - min_stint + 1):
        laps1 = np.arange(1, pit_lap + 1, dtype=float)
        ages1 = np.arange(1, pit_lap + 1, dtype=float)
        laps2 = np.arange(pit_lap + 1, total_laps + 1, dtype=float)
        ages2 = np.arange(1, total_laps - pit_lap + 1, dtype=float)

        t1 = _stint_times(
            laps1, ages1, compound_1, base_lap_time, config,
            deg_noise=deg_noise, pace_noise=pace_noise_1, compounds=compounds
        ).sum()
        t2 = _stint_times(
            laps2, ages2, compound_2, base_lap_time, config,
            deg_noise=deg_noise, pace_noise=pace_noise_2, compounds=compounds
        ).sum()
        pit_loss = _effective_pit_loss(
            pit_lap=pit_lap,
            total_laps=total_laps,
            base_pit_loss=pit_loss_time,
            sc_lap=sc_lap,
            config=config,
            traffic_scale=traffic_scale,
        )
        total = t1 + pit_loss + t2
        if total < best_time:
            best_time = total
            best_pit = pit_lap

    return best_pit, float(best_time)


def simulate_two_stop(
    total_laps: int,
    base_lap_time: float,
    pit_loss_time: float,
    compound_1: str,
    compound_2: str,
    compound_3: str,
    config: SimulationConfig,
    deg_noise: float = 0.0,
    compounds: dict = COMPOUNDS,
    sc_lap: Optional[int] = None,
    traffic_scale: float = 0.0,
    pace_noise_1: float = 0.0,
    pace_noise_2: float = 0.0,
    pace_noise_3: float = 0.0,
) -> tuple[tuple[int, int], float]:
    min_stint = config.min_stint_length
    best_time = np.inf
    best_pits = (min_stint, min_stint * 2)

    for pit1 in range(min_stint, total_laps - 2 * min_stint + 1):
        laps1 = np.arange(1, pit1 + 1, dtype=float)
        ages1 = np.arange(1, pit1 + 1, dtype=float)
        t1 = _stint_times(
            laps1, ages1, compound_1, base_lap_time, config,
            deg_noise=deg_noise, pace_noise=pace_noise_1, compounds=compounds
        ).sum()

        for pit2 in range(pit1 + min_stint, total_laps - min_stint + 1):
            laps2 = np.arange(pit1 + 1, pit2 + 1, dtype=float)
            ages2 = np.arange(1, pit2 - pit1 + 1, dtype=float)
            laps3 = np.arange(pit2 + 1, total_laps + 1, dtype=float)
            ages3 = np.arange(1, total_laps - pit2 + 1, dtype=float)

            t2 = _stint_times(
                laps2, ages2, compound_2, base_lap_time, config,
                deg_noise=deg_noise, pace_noise=pace_noise_2, compounds=compounds
            ).sum()
            t3 = _stint_times(
                laps3, ages3, compound_3, base_lap_time, config,
                deg_noise=deg_noise, pace_noise=pace_noise_3, compounds=compounds
            ).sum()

            loss1 = _effective_pit_loss(
                pit_lap=pit1,
                total_laps=total_laps,
                base_pit_loss=pit_loss_time,
                sc_lap=sc_lap,
                config=config,
                traffic_scale=traffic_scale,
            )
            loss2 = _effective_pit_loss(
                pit_lap=pit2,
                total_laps=total_laps,
                base_pit_loss=pit_loss_time + 0.3,
                sc_lap=sc_lap,
                config=config,
                traffic_scale=traffic_scale * 0.85,
            )
            total = t1 + loss1 + t2 + loss2 + t3

            if total < best_time:
                best_time = total
                best_pits = (pit1, pit2)

    return best_pits, float(best_time)


def monte_carlo_compare(
    iterations: int,
    total_laps: int,
    base_lap_time: float,
    pit_loss_time: float,
    one_stop_compounds: tuple,
    two_stop_compounds: tuple,
    safety_car_prob: float = 0.2,
    config: SimulationConfig | None = None,
    compounds: dict = COMPOUNDS,
    seed: Optional[int] = None,
) -> dict:
    """Monte Carlo comparison between one-stop and two-stop families."""
    if config is None:
        config = SimulationConfig()

    rng = np.random.default_rng(seed)

    one_times = np.zeros(iterations)
    two_times = np.zeros(iterations)
    one_pits = np.zeros(iterations, dtype=int)
    two_pits_1 = np.zeros(iterations, dtype=int)
    two_pits_2 = np.zeros(iterations, dtype=int)
    sc_flags = np.zeros(iterations, dtype=int)

    for i in range(iterations):
        has_sc = bool(rng.random() < safety_car_prob)
        sc_flags[i] = int(has_sc)
        sc_lap = int(rng.integers(5, max(6, total_laps - 4))) if has_sc else None

        scenario_pit_loss = float(max(8.0, pit_loss_time + rng.normal(0.0, 0.5)))
        traffic_scale = float(max(0.0, rng.normal(0.8, 0.45)))
        deg_noise_map, pace_noise_map = _scenario_noises(rng, compounds, config)

        pit1, t1 = simulate_one_stop(
            total_laps=total_laps,
            base_lap_time=base_lap_time,
            pit_loss_time=scenario_pit_loss,
            compound_1=one_stop_compounds[0],
            compound_2=one_stop_compounds[1],
            config=config,
            deg_noise=deg_noise_map.get(one_stop_compounds[0], 0.0),
            compounds=compounds,
            sc_lap=sc_lap,
            traffic_scale=traffic_scale,
            pace_noise_1=pace_noise_map.get(one_stop_compounds[0], 0.0),
            pace_noise_2=pace_noise_map.get(one_stop_compounds[1], 0.0),
        )

        (pit2a, pit2b), t2 = simulate_two_stop(
            total_laps=total_laps,
            base_lap_time=base_lap_time,
            pit_loss_time=scenario_pit_loss,
            compound_1=two_stop_compounds[0],
            compound_2=two_stop_compounds[1],
            compound_3=two_stop_compounds[2],
            config=config,
            deg_noise=deg_noise_map.get(two_stop_compounds[0], 0.0),
            compounds=compounds,
            sc_lap=sc_lap,
            traffic_scale=traffic_scale,
            pace_noise_1=pace_noise_map.get(two_stop_compounds[0], 0.0),
            pace_noise_2=pace_noise_map.get(two_stop_compounds[1], 0.0),
            pace_noise_3=pace_noise_map.get(two_stop_compounds[2], 0.0),
        )

        one_pits[i] = pit1
        two_pits_1[i] = pit2a
        two_pits_2[i] = pit2b
        one_times[i] = t1
        two_times[i] = t2

    deltas = one_times - two_times
    one_win_rate = float(np.mean(one_times < two_times))
    two_win_rate = 1.0 - one_win_rate

    return {
        "one_stop_win_rate": one_win_rate,
        "two_stop_win_rate": two_win_rate,
        "one_stop_mean_time": float(np.mean(one_times)),
        "two_stop_mean_time": float(np.mean(two_times)),
        "mean_delta_seconds": float(np.mean(deltas)),
        "std_delta_seconds": float(np.std(deltas)),
        "delta_p5": float(np.percentile(deltas, 5)),
        "delta_p50": float(np.percentile(deltas, 50)),
        "delta_p95": float(np.percentile(deltas, 95)),
        "one_stop_best_pit_lap_p50": int(np.percentile(one_pits, 50)),
        "one_stop_best_pit_lap_p10": int(np.percentile(one_pits, 10)),
        "one_stop_best_pit_lap_p90": int(np.percentile(one_pits, 90)),
        "two_stop_pit1_p50": int(np.percentile(two_pits_1, 50)),
        "two_stop_pit2_p50": int(np.percentile(two_pits_2, 50)),
        "sc_rate_observed": float(np.mean(sc_flags)),
    }


def recommend_strategy(
    iterations: int,
    total_laps: int,
    base_lap_time: float,
    pit_loss_time: float,
    one_stop_compounds: tuple,
    two_stop_compounds: tuple,
    safety_car_prob: float = 0.2,
    config: SimulationConfig | None = None,
    compounds: dict = COMPOUNDS,
    seed: Optional[int] = None,
) -> dict:
    """Run MC simulation and return recommendation payload."""
    result = monte_carlo_compare(
        iterations=iterations,
        total_laps=total_laps,
        base_lap_time=base_lap_time,
        pit_loss_time=pit_loss_time,
        one_stop_compounds=one_stop_compounds,
        two_stop_compounds=two_stop_compounds,
        safety_car_prob=safety_car_prob,
        config=config,
        compounds=compounds,
        seed=seed,
    )

    one_rate = result["one_stop_win_rate"]
    two_rate = result["two_stop_win_rate"]
    recommended = "1-stop" if one_rate >= two_rate else "2-stop"
    confidence = one_rate if recommended == "1-stop" else two_rate

    return {
        "recommended": recommended,
        "confidence": round(confidence, 4),
        "one_stop_win_rate": round(one_rate, 4),
        "two_stop_win_rate": round(two_rate, 4),
        "one_stop_mean_time": round(result["one_stop_mean_time"], 2),
        "two_stop_mean_time": round(result["two_stop_mean_time"], 2),
        "mean_delta_seconds": round(result["mean_delta_seconds"], 2),
        "std_delta_seconds": round(result["std_delta_seconds"], 2),
        "delta_p5": round(result["delta_p5"], 2),
        "delta_p50": round(result["delta_p50"], 2),
        "delta_p95": round(result["delta_p95"], 2),
        "pit_windows": {
            "one_stop": {
                "p10": result["one_stop_best_pit_lap_p10"],
                "p50": result["one_stop_best_pit_lap_p50"],
                "p90": result["one_stop_best_pit_lap_p90"],
            },
            "two_stop": {
                "pit1_p50": result["two_stop_pit1_p50"],
                "pit2_p50": result["two_stop_pit2_p50"],
            },
        },
        "one_stop_compounds": list(one_stop_compounds),
        "two_stop_compounds": list(two_stop_compounds),
        "pit_loss": pit_loss_time,
        "safety_car_probability": safety_car_prob,
        "iterations": iterations,
        "model_features": [
            "fuel_burn_pace_effect",
            "sc_timing_dependent_pit_loss",
            "compound_specific_noise",
            "pit_window_distribution",
        ],
    }
