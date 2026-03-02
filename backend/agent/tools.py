from backend.simulator.strategy import recommend_strategy
from backend.simulator.tracks import TRACKS
from backend.simulator.racing_line_analysis import evaluate_racing_lines


def strategy_tool(
    driver_code,
    total_laps,
    base_lap_time,
    pit_loss_time,
    safety_car_prob,
    iterations
):
    decision = recommend_strategy(
        iterations=iterations,
        total_laps=total_laps,
        base_lap_time=base_lap_time,
        pit_loss_time=pit_loss_time,
        one_stop_compounds=("medium", "hard"),
        two_stop_compounds=("soft", "medium", "hard"),
        safety_car_prob=safety_car_prob
    )

    return decision


def racing_line_tool(
    track_key,
    horizon_laps,
    iterations,
    telemetry=None,
):
    if track_key not in TRACKS:
        track_key = "bahrain" if "bahrain" in TRACKS else next(iter(TRACKS.keys()))
    return evaluate_racing_lines(
        track=TRACKS[track_key],
        telemetry=telemetry or {},
        horizon_laps=int(horizon_laps),
        iterations=int(iterations),
    )
