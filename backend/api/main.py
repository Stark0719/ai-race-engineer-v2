"""
AI Race Engineer — FastAPI Backend v7
======================================
Architecture:
- ONE simulation runs server-side as an async background task
- ALL WebSocket clients receive the same telemetry broadcast
- REST endpoints for start/stop/pit/strategy/chat
- No competing simulations

Endpoints:
  GET  /health, /drivers, /tracks
  POST /race/start, /race/stop, /race/pit
  POST /recommend, /chat
  GET  /race/state
  WS   /ws/telemetry — broadcast stream (read-only for clients)
  GET  /console — serves the unified HTML console
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import pandas as pd
import json
import asyncio
from datetime import datetime
from pathlib import Path
from dataclasses import asdict
from typing import Optional
from copy import deepcopy

from backend.simulator.strategy import recommend_strategy
from backend.simulator.config import SimulationConfig, COMPOUNDS
from backend.simulator.tracks import TRACKS
from backend.simulator.racing_line_analysis import (
    evaluate_racing_lines,
    rolling_racing_line_analysis,
)
from backend.agent.chat_engineer import chat_with_engineer
from backend.agent.rag import load_documents
from backend.live.car_simulator import LiveCarSimulator

app = FastAPI(title="AI Race Engineer API", version="7.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])
LOG_DIR = Path(__file__).resolve().parents[1] / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
Path("static").mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

features = pd.read_parquet("data/stint_features.parquet")
laps_df = pd.read_parquet("data/laps.parquet")
load_documents()
config = SimulationConfig()
VALID_COMPOUNDS = set(COMPOUNDS.keys())


def _resolve_track(track_key: Optional[str]):
    if track_key and track_key in TRACKS:
        return track_key, TRACKS[track_key]
    if race.track_key and race.track_key in TRACKS:
        return race.track_key, TRACKS[race.track_key]
    default_key = "bahrain" if "bahrain" in TRACKS else next(iter(TRACKS.keys()))
    return default_key, TRACKS[default_key]


def _calibrated_compounds_for_driver(driver_code: str) -> dict:
    """
    Build per-driver compound calibration from telemetry-derived features.
    Falls back gracefully to global defaults when columns are missing.
    """
    compounds = deepcopy(COMPOUNDS)
    df = features[features["Driver"] == driver_code]
    if df.empty:
        return compounds

    deg_col = "deg_slope_sec_per_lap" if "deg_slope_sec_per_lap" in df.columns else None
    if deg_col is None:
        return compounds

    compound_col = None
    for candidate in ("Compound", "compound", "TyreCompound", "tyre_compound"):
        if candidate in df.columns:
            compound_col = candidate
            break

    if compound_col:
        for comp_name in VALID_COMPOUNDS:
            rows = df[df[compound_col].astype(str).str.lower() == comp_name]
            if rows.empty:
                continue
            deg = float(rows[deg_col].mean())
            compounds[comp_name]["deg"] = float(max(0.001, min(0.25, deg)))
    else:
        deg = float(df[deg_col].mean())
        compounds["medium"]["deg"] = float(max(0.001, min(0.25, deg)))

    return compounds


def _driver_base_lap_time(driver_code: str, track_base_lap: float) -> float:
    driver_laps = laps_df[laps_df["Driver"] == driver_code]
    if driver_laps.empty:
        raise HTTPException(status_code=400, detail=f"No lap data for driver: {driver_code}")
    fastest_laps = driver_laps.nsmallest(8, "LapTime")["LapTime"]
    base_from_driver = float(fastest_laps.mean())
    base_lap_time = 0.65 * base_from_driver + 0.35 * float(track_base_lap)
    if pd.isna(base_lap_time):
        raise HTTPException(status_code=400, detail=f"Unable to compute base lap time for {driver_code}")
    return base_lap_time


def _make_race_decision_summary(
    strategy: dict,
    lines_now: dict,
    telemetry: dict,
) -> dict:
    current_lap = int(telemetry.get("lap_number", 1)) if telemetry else 1
    wear = float(telemetry.get("tyre_wear_pct", 0.0)) if telemetry else 0.0
    sc = bool(telemetry.get("safety_car", False)) if telemetry else False
    strategy_choice = strategy.get("recommended", "1-stop")
    pit_windows = strategy.get("pit_windows", {})
    one_stop_window = pit_windows.get("one_stop", {})
    p10 = int(one_stop_window.get("p10", max(1, current_lap + 2)))
    p90 = int(one_stop_window.get("p90", p10 + 5))
    in_window = p10 <= current_lap <= p90
    pit_now = (wear >= 0.68) or (in_window and sc)

    return {
        "current_lap": current_lap,
        "pit_window_lap_range": [p10, p90],
        "in_pit_window_now": in_window,
        "pit_now": pit_now,
        "reasoning": {
            "strategy_choice": strategy_choice,
            "strategy_confidence": strategy.get("confidence"),
            "line_choice": lines_now.get("recommended_line"),
            "line_delta_to_second_best": (
                lines_now["lines"][1]["delta_to_best"]
                if len(lines_now.get("lines", [])) > 1 else 0.0
            ),
            "wear_pct": round(wear, 3),
            "safety_car": sc,
        },
    }


def _append_log_jsonl(name: str, payload: dict):
    path = LOG_DIR / f"{name}_{datetime.utcnow().strftime('%Y%m%d')}.jsonl"
    row = {"ts_utc": datetime.utcnow().isoformat(), **payload}
    with open(path, "a") as f:
        f.write(json.dumps(row) + "\n")

# ---- Global Race State ----
class RaceState:
    def __init__(self):
        self.sim: Optional[LiveCarSimulator] = None
        self.running = False
        self.task: Optional[asyncio.Task] = None
        self.clients: list[WebSocket] = []
        self.telemetry_log: list = []
        self.lap_times: list = []
        self.track_key = ""
        self.speed_multiplier = 10
        self.last_frame: dict = {}

race = RaceState()


# ---- Broadcast to all WS clients ----
async def broadcast(data: dict):
    dead = []
    msg = json.dumps(data)
    for ws in race.clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        race.clients.remove(ws)


# ---- Simulation loop (runs as background task) ----
async def simulation_loop():
    tick_rate = 20
    real_dt = 1.0 / tick_rate
    prev_lap = 1

    # Send track info
    track = TRACKS[race.track_key]
    await broadcast({
        "type": "track_info",
        "name": track.name, "country": track.country,
        "total_laps": track.total_laps,
        "waypoints_xy": track.xy_points,
        "track_width": track.track_width_m,
    })

    while race.running and race.sim and not race.sim.is_race_finished():
        dt_sim = race.speed_multiplier * real_dt
        race.sim.tick(dt_sim, real_dt=real_dt)
        frame = race.sim.generate_frame()
        fd = asdict(frame)
        fd["type"] = "telemetry"
        race.last_frame = fd
        race.telemetry_log.append(fd)

        # Track lap times
        if fd["lap_number"] > prev_lap and fd["last_lap_time"] > 0:
            race.lap_times.append({
                "lap": prev_lap, "time": fd["last_lap_time"],
                "compound": fd["tyre_compound"],
                "s1": fd["sector_1_time"], "s2": fd["sector_2_time"],
                "s3": fd["sector_3_time"],
            })
            prev_lap = fd["lap_number"]

        await broadcast(fd)
        await asyncio.sleep(real_dt)

    # Race finished
    if race.sim:
        finish = {
            "type": "race_finished",
            "total_laps": race.sim.lap_number - 1,
            "total_time": round(race.sim.total_race_time, 2),
            "pit_history": race.sim.pit_history,
        }
        await broadcast(finish)

        # Save log
        log_path = LOG_DIR / f"telemetry_{race.track_key}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        with open(log_path, "w") as f:
            json.dump(race.telemetry_log, f)

    race.running = False


# ---- REST Endpoints ----

@app.get("/health")
def health():
    return {"status": "ok", "race_active": race.running}

@app.get("/drivers")
def list_drivers():
    return {"drivers": sorted(features["Driver"].unique().tolist())}

@app.get("/tracks")
def list_tracks():
    return {
        "tracks": {
            key: {
                "key": key,
                "name": t.name, "country": t.country,
                "total_laps": t.total_laps,
                "base_lap_time": t.base_lap_time_sec,
                "pit_loss": t.pit_loss_sec,
                "safety_car_prob": t.safety_car_probability,
                "circuit_length_m": t.circuit_length_m,
                "waypoints_xy": t.xy_points,
                "headings": [w[3] for w in t.waypoints],
                "speeds": t.speeds,
                "sector_boundaries": t.sector_boundaries,
                "corners": t.corners,
                "bounds": t.bounds,
                "track_width": t.track_width_m,
            }
            for key, t in TRACKS.items()
        }
    }

@app.get("/race/state")
def race_state():
    return {
        "running": race.running,
        "track": race.track_key,
        "frame": race.last_frame,
        "lap_times": race.lap_times,
        "telemetry_count": len(race.telemetry_log),
    }

@app.post("/race/start")
async def race_start(track: str = "bahrain", compound: str = "medium",
                     speed: int = Query(10, ge=1, le=100), pit_lap: int = Query(0, ge=0),
                     next_compound: str = "hard", driver: str = "VER"):
    if race.running:
        return {"error": "Race already running. Stop first."}
    if track not in TRACKS:
        return {"error": f"Unknown track: {track}"}
    if compound not in VALID_COMPOUNDS:
        raise HTTPException(status_code=400, detail=f"Invalid compound: {compound}")
    if next_compound not in VALID_COMPOUNDS:
        raise HTTPException(status_code=400, detail=f"Invalid next_compound: {next_compound}")
    if driver not in features["Driver"].values:
        raise HTTPException(status_code=400, detail=f"Unknown driver: {driver}")
    if pit_lap >= TRACKS[track].total_laps:
        raise HTTPException(status_code=400, detail="pit_lap must be lower than total laps")

    race.track_key = track
    race.speed_multiplier = speed
    race.telemetry_log = []
    race.lap_times = []
    race.last_frame = {}
    race.sim = LiveCarSimulator(track, compound=compound, driver=driver, config=config)
    if pit_lap > 0:
        race.sim.pit_stop_at_lap = pit_lap
        race.sim.next_compound = next_compound
    race.running = True
    race.task = asyncio.create_task(simulation_loop())
    return {"status": "started", "track": track, "laps": TRACKS[track].total_laps}

@app.post("/race/stop")
async def race_stop():
    race.running = False
    if race.task:
        race.task.cancel()
        try:
            await race.task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
    race.task = None
    race.sim = None
    await broadcast({"type": "race_stopped"})
    return {"status": "stopped"}

@app.post("/race/pit")
def race_pit(compound: str = "hard"):
    if compound not in VALID_COMPOUNDS:
        raise HTTPException(status_code=400, detail=f"Invalid compound: {compound}")
    if race.sim and race.running:
        race.sim.pit_stop(compound)
        return {"status": "pit_stop", "new_compound": compound}
    return {"error": "No active race"}

@app.post("/race/speed")
def race_speed(speed: int = Query(10, ge=1, le=100)):
    race.speed_multiplier = max(1, min(100, speed))
    return {"speed": race.speed_multiplier}

# ---- Strategy ----
@app.post("/recommend")
def recommend(driver_code: str = "VER", pit_loss: float = Query(20, ge=0),
              safety_car_prob: float = Query(0.2, ge=0, le=1),
              iterations: int = Query(300, ge=1, le=20000),
              track: Optional[str] = None):
    driver_stints = features[features["Driver"] == driver_code]
    if driver_stints.empty:
        raise HTTPException(status_code=400, detail=f"Unknown driver: {driver_code}")
    driver_laps = laps_df[laps_df["Driver"] == driver_code]
    track_key, track_profile = _resolve_track(track)
    base_lap_time = _driver_base_lap_time(driver_code, track_profile.base_lap_time_sec)

    compounds = _calibrated_compounds_for_driver(driver_code)
    decision = recommend_strategy(
        iterations=iterations, total_laps=track_profile.total_laps,
        base_lap_time=base_lap_time, pit_loss_time=pit_loss,
        one_stop_compounds=("medium", "hard"),
        two_stop_compounds=("soft", "medium", "hard"),
        safety_car_prob=safety_car_prob, config=config, compounds=compounds)
    decision["track"] = track_key
    decision["track_total_laps"] = track_profile.total_laps
    decision["base_lap_time_estimate"] = round(base_lap_time, 3)
    _append_log_jsonl("strategy_recommend", {
        "driver_code": driver_code,
        "track": track_key,
        "iterations": iterations,
        "recommended": decision.get("recommended"),
        "confidence": decision.get("confidence"),
    })
    return decision


@app.post("/analytics/racing-lines")
def racing_line_analytics(
    track: Optional[str] = None,
    horizon_laps: int = Query(5, ge=1, le=20),
    iterations: int = Query(400, ge=50, le=5000),
    seed: Optional[int] = Query(None),
):
    track_key, track_profile = _resolve_track(track)
    telemetry = race.last_frame if (race.last_frame and race.track_key == track_key) else {}
    result = evaluate_racing_lines(
        track=track_profile,
        telemetry=telemetry,
        horizon_laps=horizon_laps,
        iterations=iterations,
        seed=seed,
    )
    result["race_running"] = bool(race.running and race.track_key == track_key)
    _append_log_jsonl("racing_lines_now", {
        "track": track_key,
        "horizon_laps": horizon_laps,
        "iterations": iterations,
        "recommended_line": result.get("recommended_line"),
        "race_running": result.get("race_running"),
    })
    return result


@app.post("/analytics/racing-lines/rolling")
def racing_line_analytics_rolling(
    track: Optional[str] = None,
    window_laps: int = Query(8, ge=2, le=30),
    horizon_laps: int = Query(4, ge=1, le=20),
    iterations: int = Query(250, ge=50, le=3000),
    seed: Optional[int] = Query(None),
):
    track_key, track_profile = _resolve_track(track)
    telemetry = race.last_frame if (race.last_frame and race.track_key == track_key) else {}
    result = rolling_racing_line_analysis(
        track=track_profile,
        telemetry=telemetry,
        window_laps=window_laps,
        horizon_laps=horizon_laps,
        iterations=iterations,
        seed=seed,
    )
    result["race_running"] = bool(race.running and race.track_key == track_key)
    first_line = result.get("rollout", [{}])[0].get("recommended_line")
    _append_log_jsonl("racing_lines_rolling", {
        "track": track_key,
        "window_laps": window_laps,
        "horizon_laps": horizon_laps,
        "iterations": iterations,
        "lap1_line": first_line,
        "race_running": result.get("race_running"),
    })
    return result


@app.post("/decision/race")
def race_decision(
    driver_code: str = "VER",
    track: Optional[str] = None,
    pit_loss: Optional[float] = Query(None, ge=0),
    safety_car_prob: Optional[float] = Query(None, ge=0, le=1),
    strategy_iterations: int = Query(500, ge=50, le=30000),
    line_horizon_laps: int = Query(6, ge=1, le=20),
    line_iterations: int = Query(500, ge=50, le=5000),
    rolling_window_laps: int = Query(10, ge=2, le=30),
    rolling_horizon_laps: int = Query(4, ge=1, le=20),
    rolling_iterations: int = Query(300, ge=50, le=3000),
    seed: Optional[int] = Query(None),
):
    driver_stints = features[features["Driver"] == driver_code]
    if driver_stints.empty:
        raise HTTPException(status_code=400, detail=f"Unknown driver: {driver_code}")

    track_key, track_profile = _resolve_track(track)
    telemetry = race.last_frame if (race.last_frame and race.track_key == track_key) else {}
    sc_prob = safety_car_prob if safety_car_prob is not None else float(track_profile.safety_car_probability)
    pit_loss_value = pit_loss if pit_loss is not None else float(track_profile.pit_loss_sec)
    base_lap_time = _driver_base_lap_time(driver_code, track_profile.base_lap_time_sec)
    compounds = _calibrated_compounds_for_driver(driver_code)

    strategy = recommend_strategy(
        iterations=strategy_iterations,
        total_laps=track_profile.total_laps,
        base_lap_time=base_lap_time,
        pit_loss_time=pit_loss_value,
        one_stop_compounds=("medium", "hard"),
        two_stop_compounds=("soft", "medium", "hard"),
        safety_car_prob=sc_prob,
        config=config,
        compounds=compounds,
        seed=seed,
    )
    strategy["track"] = track_key
    strategy["track_total_laps"] = track_profile.total_laps
    strategy["base_lap_time_estimate"] = round(base_lap_time, 3)

    line_now = evaluate_racing_lines(
        track=track_profile,
        telemetry=telemetry,
        horizon_laps=line_horizon_laps,
        iterations=line_iterations,
        seed=seed,
    )
    line_roll = rolling_racing_line_analysis(
        track=track_profile,
        telemetry=telemetry,
        window_laps=rolling_window_laps,
        horizon_laps=rolling_horizon_laps,
        iterations=rolling_iterations,
        seed=seed,
    )

    response = {
        "decision": _make_race_decision_summary(strategy, line_now, telemetry),
        "strategy": strategy,
        "racing_lines_now": line_now,
        "racing_lines_rolling": line_roll,
        "context": {
            "driver_code": driver_code,
            "track": track_key,
            "race_running": bool(race.running and race.track_key == track_key),
            "telemetry_used": bool(telemetry),
        },
    }
    _append_log_jsonl("race_decision", {
        "driver_code": driver_code,
        "track": track_key,
        "race_running": response["context"]["race_running"],
        "pit_now": response["decision"]["pit_now"],
        "strategy": response["decision"]["reasoning"]["strategy_choice"],
        "line": response["decision"]["reasoning"]["line_choice"],
    })
    return response

# ---- Chat ----
@app.post("/chat")
def chat(driver_code: str = "VER", message: str = ""):
    if not message.strip():
        raise HTTPException(status_code=400, detail="Message must not be empty")
    driver_laps = laps_df[laps_df["Driver"] == driver_code]
    if driver_laps.empty:
        raise HTTPException(status_code=400, detail=f"Unknown driver: {driver_code}")
    base_lap_time = driver_laps.nsmallest(5, "LapTime")["LapTime"].mean()
    if pd.isna(base_lap_time):
        raise HTTPException(status_code=400, detail=f"Unable to compute base lap time for {driver_code}")
    track_key, track_profile = _resolve_track(race.track_key or None)
    telemetry = race.last_frame if race.last_frame else {}
    live_context = {
        "track_key": track_key,
        "track_name": track_profile.name,
        "total_laps": track_profile.total_laps,
        "pit_loss_time": float(track_profile.pit_loss_sec),
        "safety_car_prob": float(track_profile.safety_car_probability),
        "race_running": bool(race.running),
        "speed_multiplier": int(race.speed_multiplier),
        "strategy_iterations": 220,
        "line_horizon_laps": 5,
        "line_iterations": 180,
        "lap_times": race.lap_times,
        "telemetry": telemetry,
    }
    response = chat_with_engineer(
        user_message=message, driver_code=driver_code,
        base_lap_time=base_lap_time,
        live_context=live_context,
    )
    return {"response": response}

# ---- WebSocket (read-only telemetry broadcast) ----
@app.websocket("/ws/telemetry")
async def ws_telemetry(websocket: WebSocket):
    await websocket.accept()
    race.clients.append(websocket)

    # If race is already running, send track info
    if race.running and race.track_key:
        track = TRACKS[race.track_key]
        await websocket.send_json({
            "type": "track_info",
            "name": track.name, "country": track.country,
            "total_laps": track.total_laps,
            "waypoints_xy": track.xy_points,
            "track_width": track.track_width_m,
        })

    try:
        while True:
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        if websocket in race.clients:
            race.clients.remove(websocket)

# ---- Serve Console ----
@app.get("/console")
def console():
    return FileResponse("static/console.html")

@app.get("/")
def root():
    return FileResponse("static/console.html")
