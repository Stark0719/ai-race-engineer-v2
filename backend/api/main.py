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
from pydantic import BaseModel, Field, field_validator
import pandas as pd
import re
import json
import asyncio
import aiofiles
import logging
import time as time_module
from collections import defaultdict, deque
from datetime import datetime
from uuid import uuid4
from pathlib import Path
from dataclasses import fields as dataclass_fields
from typing import Optional
from copy import deepcopy

from backend.simulator.strategy import (
    recommend_strategy, recommend_strategy_with_weather,
    compute_fuel_curve, compute_fuel_adjusted_pit_window,
)
from backend.simulator.undercut import scan_all_opportunities
from backend.api.sessions import (
    SavedSession, save_session as save_session_to_disk,
    load_session as load_saved_session, list_sessions, delete_session,
)
from backend.simulator.config import SimulationConfig, COMPOUNDS
from backend.simulator.weather import WeatherConfig
from backend.simulator.tyre_model import get_tyre_model
from backend.simulator.tracks import TRACKS
from backend.simulator.racing_line_analysis import (
    evaluate_racing_lines,
    rolling_racing_line_analysis,
)
from backend.agent.chat_engineer import chat_with_engineer
from backend.agent.rag import load_documents
from backend.live.car_simulator import LiveCarSimulator
from backend.live.replay import ReplaySimulator, MultiCarReplaySimulator
from backend.live.fastf1_loader import (
    get_schedule,
    load_session as load_f1_session,
    extract_driver_frames,
    extract_track_waypoints,
    extract_all_drivers_positions,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="AI Race Engineer API", version="7.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])
LOG_DIR = Path(__file__).resolve().parents[1] / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
Path("static").mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

class RateLimiter:
    """Sliding-window rate limiter keyed by client identifier."""
    def __init__(self, max_requests: int = 30, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, client_id: str) -> bool:
        now = time_module.time()
        window_start = now - self.window_seconds
        self._requests[client_id] = [
            t for t in self._requests[client_id] if t > window_start
        ]
        if len(self._requests[client_id]) >= self.max_requests:
            return False
        self._requests[client_id].append(now)
        return True


class ChatRequest(BaseModel):
    driver_code: str = Field(default="VER", pattern=r"^[A-Z]{3}$")
    message: str = Field(default="", max_length=2000)

    @field_validator("message")
    @classmethod
    def strip_html(cls, v: str) -> str:
        return re.sub(r"<[^>]+>", "", v).strip()


class RaceStartRequest(BaseModel):
    track: str = Field(default="bahrain", max_length=50)
    compound: str = Field(default="medium")
    speed: int = Field(default=10, ge=1, le=100)
    pit_lap: int = Field(default=0, ge=0)
    next_compound: str = Field(default="hard")
    driver: str = Field(default="VER", pattern=r"^[A-Z]{3}$")

    @field_validator("compound", "next_compound")
    @classmethod
    def validate_compound(cls, v: str) -> str:
        valid = {"soft", "medium", "hard", "intermediate", "wet"}
        if v not in valid:
            raise ValueError(f"Invalid compound: {v}")
        return v


chat_rate_limiter = RateLimiter(max_requests=30, window_seconds=60)

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
    Build per-driver compound calibration using the ML tyre model.
    Falls back gracefully to global defaults when data is unavailable.
    """
    return get_tyre_model().get_calibrated_compounds(driver_code)


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


async def _append_log_jsonl(name: str, payload: dict):
    path = LOG_DIR / f"{name}_{datetime.utcnow().strftime('%Y%m%d')}.jsonl"
    row = {"ts_utc": datetime.utcnow().isoformat(), **payload}
    try:
        async with aiofiles.open(path, "a") as f:
            await f.write(json.dumps(row) + "\n")
    except Exception:
        pass  # non-critical logging, don't block

# ---- Global Race State ----
class RaceState:
    def __init__(self):
        self.sim = None  # LiveCarSimulator, ReplaySimulator, or MultiCarReplaySimulator
        self.running = False
        self.task: Optional[asyncio.Task] = None
        self.clients: list[WebSocket] = []
        self.telemetry_log: deque = deque(maxlen=50000)
        self.lap_times: list = []
        self.track_key = ""
        self.speed_multiplier = 1
        self.last_frame: dict = {}
        self.track_info_msg: dict = {}  # pre-built track_info for broadcast
        self.multi_car = False
        self.drivers_info: list[dict] = []  # [{abbreviation, name, team, number}]

race = RaceState()


# ---- Broadcast to all WS clients ----
async def broadcast(data: dict):
    if not race.clients:
        return
    msg = json.dumps(data)

    async def _send(ws: WebSocket):
        try:
            await ws.send_text(msg)
            return None
        except Exception:
            return ws

    results = await asyncio.gather(*[_send(ws) for ws in race.clients])
    dead = [ws for ws in results if ws is not None]
    for ws in dead:
        if ws in race.clients:
            race.clients.remove(ws)


# ---- Fast frame-to-dict (avoids deep-copy overhead of dataclasses.asdict) ----
_FRAME_FIELDS = None

def _frame_to_dict(frame) -> dict:
    global _FRAME_FIELDS
    if _FRAME_FIELDS is None:
        _FRAME_FIELDS = [f.name for f in dataclass_fields(frame.__class__)]
    return {name: getattr(frame, name) for name in _FRAME_FIELDS}


# ---- Simulation loop (runs as background task) ----
async def simulation_loop():
    tick_rate = config.tick_rate
    real_dt = 1.0 / tick_rate
    prev_lap = 1
    tick_count = 0

    try:
        # Send track info (pre-built by the start endpoint)
        if race.track_info_msg:
            await broadcast(race.track_info_msg)

        # Send drivers_info once at the start for multi-car replays
        if race.multi_car and race.drivers_info:
            await broadcast({"type": "drivers_info", "drivers": race.drivers_info})

        while race.running and race.sim and not race.sim.is_race_finished():
            try:
                dt_sim = race.speed_multiplier * real_dt
                race.sim.tick(dt_sim, real_dt=real_dt)
                frame = race.sim.generate_frame()
                fd = _frame_to_dict(frame)
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

                # Adaptive broadcast: at low speed (<=2x) send every other tick (~10Hz),
                # at higher speeds broadcast every tick (20Hz) so the car doesn't jump.
                broadcast_interval = 2 if race.speed_multiplier <= 2 else 1
                if tick_count % broadcast_interval == 0:
                    # Attach ghost car positions and timing gaps periodically
                    if (
                        race.multi_car
                        and isinstance(race.sim, MultiCarReplaySimulator)
                        and tick_count % (config.ws_ghost_tick_interval * max(1, broadcast_interval)) == 0
                    ):
                        fd["cars"] = race.sim.generate_car_positions()
                        fd["timing"] = race.sim.compute_timing_gaps()

                    await broadcast(fd)
                tick_count += 1
            except Exception as tick_err:
                logger.error(f"Tick error: {tick_err}", exc_info=True)

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

            # Save log (async to avoid blocking)
            log_path = LOG_DIR / f"telemetry_{race.track_key}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
            try:
                async with aiofiles.open(log_path, "w") as f:
                    await f.write(json.dumps(list(race.telemetry_log)))
            except Exception:
                logger.warning("Failed to save telemetry log")

            # Auto-save session
            try:
                driver = getattr(race.sim, 'driver', "unknown")
                if isinstance(race.sim, MultiCarReplaySimulator):
                    driver = race.sim._focused_driver
                elif hasattr(race.sim, '_inner') and hasattr(race.sim._inner, 'frames') and race.sim._inner.frames:
                    driver = "replay"
                session = SavedSession(
                    id=str(uuid4()),
                    timestamp=datetime.utcnow().isoformat(),
                    track=race.track_key,
                    driver=driver,
                    mode="replay" if isinstance(race.sim, (ReplaySimulator, MultiCarReplaySimulator)) else "sim",
                    total_laps=race.sim.lap_number - 1,
                    total_time=round(race.sim.total_race_time, 2),
                    lap_times=race.lap_times,
                    pit_history=race.sim.pit_history,
                )
                save_session_to_disk(session)
            except Exception as save_err:
                logger.warning(f"Failed to auto-save session: {save_err}")

    except asyncio.CancelledError:
        logger.info("Simulation loop cancelled")
    except Exception as e:
        logger.error(f"Simulation loop fatal error: {e}", exc_info=True)
        await broadcast({"type": "error", "message": str(e)})
    finally:
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
                     speed: int = Query(1, ge=1, le=100), pit_lap: int = Query(0, ge=0),
                     next_compound: str = "hard", driver: str = "VER"):
    if race.running:
        await _stop_race()
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
    race.telemetry_log = deque(maxlen=50000)
    race.lap_times = []
    race.last_frame = {}
    t = TRACKS[track]
    race.track_info_msg = {
        "type": "track_info",
        "name": t.name, "country": t.country,
        "total_laps": t.total_laps,
        "waypoints_xy": t.xy_points,
        "track_width": t.track_width_m,
    }
    race.sim = LiveCarSimulator(track, compound=compound, driver=driver, config=config)
    if pit_lap > 0:
        race.sim.pit_stop_at_lap = pit_lap
        race.sim.next_compound = next_compound
    race.running = True
    race.task = asyncio.create_task(simulation_loop())
    return {"status": "started", "track": track, "laps": TRACKS[track].total_laps}

async def _stop_race():
    """Internal helper to stop a running race."""
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

@app.post("/race/stop")
async def race_stop():
    await _stop_race()
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
async def recommend(driver_code: str = "VER", pit_loss: float = Query(20, ge=0),
              safety_car_prob: float = Query(0.2, ge=0, le=1),
              iterations: int = Query(300, ge=1, le=20000),
              track: Optional[str] = None,
              rain_probability: float = Query(0.0, ge=0.0, le=1.0),
              ambient_temp_c: float = Query(28.0, ge=-10.0, le=60.0)):
    driver_stints = features[features["Driver"] == driver_code]
    if driver_stints.empty:
        raise HTTPException(status_code=400, detail=f"Unknown driver: {driver_code}")
    track_key, track_profile = _resolve_track(track)
    base_lap_time = _driver_base_lap_time(driver_code, track_profile.base_lap_time_sec)

    compounds = _calibrated_compounds_for_driver(driver_code)

    def _run_strategy():
        if rain_probability > 0.0:
            weather_config = WeatherConfig(
                rain_probability_per_lap=rain_probability,
                ambient_temp_c=ambient_temp_c,
            )
            return recommend_strategy_with_weather(
                iterations=iterations, total_laps=track_profile.total_laps,
                base_lap_time=base_lap_time, pit_loss_time=pit_loss,
                weather_config=weather_config,
                safety_car_prob=safety_car_prob, config=config, compounds=compounds)
        else:
            return recommend_strategy(
                iterations=iterations, total_laps=track_profile.total_laps,
                base_lap_time=base_lap_time, pit_loss_time=pit_loss,
                one_stop_compounds=("medium", "hard"),
                two_stop_compounds=("soft", "medium", "hard"),
                safety_car_prob=safety_car_prob, config=config, compounds=compounds)

    decision = await asyncio.to_thread(_run_strategy)
    decision["track"] = track_key
    decision["track_total_laps"] = track_profile.total_laps
    decision["base_lap_time_estimate"] = round(base_lap_time, 3)
    await _append_log_jsonl("strategy_recommend", {
        "driver_code": driver_code,
        "track": track_key,
        "iterations": iterations,
        "recommended": decision.get("recommended"),
        "confidence": decision.get("confidence"),
    })
    return decision


@app.post("/analytics/racing-lines")
async def racing_line_analytics(
    track: Optional[str] = None,
    horizon_laps: int = Query(5, ge=1, le=20),
    iterations: int = Query(400, ge=50, le=5000),
    seed: Optional[int] = Query(None),
):
    track_key, track_profile = _resolve_track(track)
    telemetry = race.last_frame if (race.last_frame and race.track_key == track_key) else {}
    result = await asyncio.to_thread(
        evaluate_racing_lines,
        track=track_profile,
        telemetry=telemetry,
        horizon_laps=horizon_laps,
        iterations=iterations,
        seed=seed,
    )
    result["race_running"] = bool(race.running and race.track_key == track_key)
    await _append_log_jsonl("racing_lines_now", {
        "track": track_key,
        "horizon_laps": horizon_laps,
        "iterations": iterations,
        "recommended_line": result.get("recommended_line"),
        "race_running": result.get("race_running"),
    })
    return result


@app.post("/analytics/racing-lines/rolling")
async def racing_line_analytics_rolling(
    track: Optional[str] = None,
    window_laps: int = Query(8, ge=2, le=30),
    horizon_laps: int = Query(4, ge=1, le=20),
    iterations: int = Query(250, ge=50, le=3000),
    seed: Optional[int] = Query(None),
):
    track_key, track_profile = _resolve_track(track)
    telemetry = race.last_frame if (race.last_frame and race.track_key == track_key) else {}
    result = await asyncio.to_thread(
        rolling_racing_line_analysis,
        track=track_profile,
        telemetry=telemetry,
        window_laps=window_laps,
        horizon_laps=horizon_laps,
        iterations=iterations,
        seed=seed,
    )
    result["race_running"] = bool(race.running and race.track_key == track_key)
    first_line = result.get("rollout", [{}])[0].get("recommended_line")
    await _append_log_jsonl("racing_lines_rolling", {
        "track": track_key,
        "window_laps": window_laps,
        "horizon_laps": horizon_laps,
        "iterations": iterations,
        "lap1_line": first_line,
        "race_running": result.get("race_running"),
    })
    return result


@app.post("/decision/race")
async def race_decision(
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
    rain_probability: float = Query(0.0, ge=0.0, le=1.0),
    ambient_temp_c: float = Query(28.0, ge=-10.0, le=60.0),
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

    # Run all three heavy computations in parallel threads
    def _run_strategy():
        if rain_probability > 0.0:
            weather_cfg = WeatherConfig(
                rain_probability_per_lap=rain_probability,
                ambient_temp_c=ambient_temp_c,
            )
            return recommend_strategy_with_weather(
                iterations=strategy_iterations,
                total_laps=track_profile.total_laps,
                base_lap_time=base_lap_time,
                pit_loss_time=pit_loss_value,
                weather_config=weather_cfg,
                safety_car_prob=sc_prob,
                config=config,
                compounds=compounds,
                seed=seed,
            )
        else:
            return recommend_strategy(
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

    def _run_lines():
        return evaluate_racing_lines(
            track=track_profile,
            telemetry=telemetry,
            horizon_laps=line_horizon_laps,
            iterations=line_iterations,
            seed=seed,
        )

    def _run_rolling():
        return rolling_racing_line_analysis(
            track=track_profile,
            telemetry=telemetry,
            window_laps=rolling_window_laps,
            horizon_laps=rolling_horizon_laps,
            iterations=rolling_iterations,
            seed=seed,
        )

    strategy, line_now, line_roll = await asyncio.gather(
        asyncio.to_thread(_run_strategy),
        asyncio.to_thread(_run_lines),
        asyncio.to_thread(_run_rolling),
    )

    strategy["track"] = track_key
    strategy["track_total_laps"] = track_profile.total_laps
    strategy["base_lap_time_estimate"] = round(base_lap_time, 3)

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
    await _append_log_jsonl("race_decision", {
        "driver_code": driver_code,
        "track": track_key,
        "race_running": response["context"]["race_running"],
        "pit_now": response["decision"]["pit_now"],
        "strategy": response["decision"]["reasoning"]["strategy_choice"],
        "line": response["decision"]["reasoning"]["line_choice"],
    })
    return response

# ---- Saved Sessions ----

@app.get("/sessions/saved")
def saved_sessions_list():
    """List all saved sessions."""
    return {"sessions": list_sessions()}


@app.get("/sessions/saved/{session_id}")
def saved_session_get(session_id: str):
    """Load a specific saved session."""
    session = load_saved_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    from dataclasses import asdict
    return asdict(session)


@app.post("/sessions/save")
def saved_session_create():
    """Manually save current race state."""
    if not race.lap_times:
        raise HTTPException(status_code=400, detail="No race data to save")
    driver = "unknown"
    if isinstance(race.sim, MultiCarReplaySimulator):
        driver = race.sim._focused_driver
    session = SavedSession(
        id=str(uuid4()),
        timestamp=datetime.utcnow().isoformat(),
        track=race.track_key,
        driver=driver,
        mode="replay" if isinstance(race.sim, (ReplaySimulator, MultiCarReplaySimulator)) else "sim",
        total_laps=race.sim.lap_number - 1 if race.sim else len(race.lap_times),
        total_time=round(race.sim.total_race_time, 2) if race.sim else 0,
        lap_times=race.lap_times,
        pit_history=race.sim.pit_history if race.sim else [],
    )
    save_session_to_disk(session)
    return {"id": session.id, "status": "saved"}


@app.delete("/sessions/saved/{session_id}")
def saved_session_delete(session_id: str):
    """Delete a saved session."""
    if delete_session(session_id):
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail=f"Session {session_id} not found")


# ---- Analytics ----

@app.get("/analytics/post-race")
def post_race_analytics():
    """Generate post-race analytics summary with stint analysis and consistency metrics."""
    if race.running:
        raise HTTPException(status_code=400, detail="Race still running")
    if not race.lap_times:
        raise HTTPException(status_code=404, detail="No race data available")

    # Group laps by compound (stints)
    stints: list[dict] = []
    current_compound = None
    current_stint_laps: list[dict] = []

    for lt in race.lap_times:
        if lt["compound"] != current_compound:
            if current_stint_laps:
                times = [l["time"] for l in current_stint_laps]
                stints.append({
                    "compound": current_compound,
                    "laps": len(current_stint_laps),
                    "start_lap": current_stint_laps[0]["lap"],
                    "end_lap": current_stint_laps[-1]["lap"],
                    "avg_time": round(sum(times) / len(times), 3),
                    "best_time": round(min(times), 3),
                    "worst_time": round(max(times), 3),
                })
            current_compound = lt["compound"]
            current_stint_laps = [lt]
        else:
            current_stint_laps.append(lt)

    if current_stint_laps:
        times = [l["time"] for l in current_stint_laps]
        stints.append({
            "compound": current_compound,
            "laps": len(current_stint_laps),
            "start_lap": current_stint_laps[0]["lap"],
            "end_lap": current_stint_laps[-1]["lap"],
            "avg_time": round(sum(times) / len(times), 3),
            "best_time": round(min(times), 3),
            "worst_time": round(max(times), 3),
        })

    # Degradation curve per stint
    degradation = []
    for i, stint in enumerate(stints):
        stint_laps = [lt for lt in race.lap_times if stint["start_lap"] <= lt["lap"] <= stint["end_lap"]]
        if len(stint_laps) >= 3:
            times = [l["time"] for l in stint_laps]
            # Simple linear slope: (last - first) / n_laps
            slope = round((times[-1] - times[0]) / max(1, len(times) - 1), 4)
            degradation.append({"stint": i + 1, "compound": stint["compound"], "slope": slope})

    # Sector evolution
    sector_evolution = [
        {"lap": lt["lap"], "s1": lt.get("s1", 0), "s2": lt.get("s2", 0), "s3": lt.get("s3", 0)}
        for lt in race.lap_times
    ]

    # Consistency score (lower std dev = more consistent)
    all_times = [lt["time"] for lt in race.lap_times]
    if len(all_times) >= 3:
        import numpy as np
        std = float(np.std(all_times))
        # Normalize: 0-100 where 100 = perfectly consistent
        consistency = round(max(0, 100 - std * 20), 1)
    else:
        consistency = 0.0

    return {
        "lap_times": race.lap_times,
        "stint_summary": stints,
        "degradation_curve": degradation,
        "total_time": round(race.sim.total_race_time, 2) if race.sim else 0,
        "pit_history": race.sim.pit_history if race.sim else [],
        "consistency_score": consistency,
        "sector_evolution": sector_evolution,
    }


@app.post("/analytics/fuel")
def fuel_analytics(driver_code: str = "VER", track: Optional[str] = None):
    """Compute fuel burn curve and fuel-adjusted optimal pit window."""
    driver_stints = features[features["Driver"] == driver_code]
    if driver_stints.empty:
        raise HTTPException(status_code=400, detail=f"Unknown driver: {driver_code}")
    track_key, track_profile = _resolve_track(track)
    base_lap_time = _driver_base_lap_time(driver_code, track_profile.base_lap_time_sec)
    compounds = _calibrated_compounds_for_driver(driver_code)

    fuel_curve = compute_fuel_curve(
        total_laps=track_profile.total_laps,
        base_lap_time=base_lap_time,
        fuel_start_kg=config.fuel_start_kg,
        fuel_per_lap_kg=config.fuel_per_lap_kg,
    )
    pit_window = compute_fuel_adjusted_pit_window(
        total_laps=track_profile.total_laps,
        base_lap_time=base_lap_time,
        pit_loss_time=float(track_profile.pit_loss_sec),
        config=config,
        compounds=compounds,
        fuel_start_kg=config.fuel_start_kg,
        fuel_per_lap_kg=config.fuel_per_lap_kg,
    )

    return {
        "driver": driver_code,
        "track": track_key,
        "fuel_curve": fuel_curve,
        "pit_window": pit_window,
        "fuel_start_kg": config.fuel_start_kg,
        "fuel_per_lap_kg": config.fuel_per_lap_kg,
    }


@app.post("/analytics/undercut")
def undercut_analytics(driver_code: str = "VER", track: Optional[str] = None):
    """Scan for undercut/overcut opportunities against nearby rivals."""
    if not race.running or not race.last_frame:
        raise HTTPException(status_code=400, detail="No active race for undercut analysis")

    current_lap = race.last_frame.get("lap_number", 1)
    focused_compound = race.last_frame.get("tyre_compound", "medium")
    focused_tyre_age = race.last_frame.get("tyre_age_laps", 1)
    track_key, track_profile = _resolve_track(track)

    # Build rival lap times from timing gaps if available
    all_rival_laps: dict[str, list[dict]] = {}
    if isinstance(race.sim, MultiCarReplaySimulator):
        for drv, frames in race.sim._all_positions.items():
            idx = race.sim._pos_indices[drv]
            rival_laps = []
            seen_laps = set()
            for f in frames[:idx + 1]:
                lap_num = f.get("lap_number", 0)
                lt = f.get("last_lap_time", 0)
                if lt > 0 and lap_num not in seen_laps:
                    rival_laps.append({"lap": lap_num, "time": lt})
                    seen_laps.add(lap_num)
            if rival_laps:
                all_rival_laps[drv] = rival_laps

    compounds = _calibrated_compounds_for_driver(driver_code)
    opportunities = scan_all_opportunities(
        focused_lap_times=race.lap_times,
        all_rival_laps=all_rival_laps,
        pit_loss=float(track_profile.pit_loss_sec),
        current_lap=current_lap,
        focused_compound=focused_compound,
        focused_tyre_age=focused_tyre_age,
        compounds=compounds,
    )

    # Return top opportunities
    return {
        "current_lap": current_lap,
        "opportunities": opportunities[:10],
    }


@app.get("/analytics/sectors")
def sector_comparison(target_driver: str = "HAM"):
    """Compare sector times between focused driver and a target driver."""
    if not isinstance(race.sim, MultiCarReplaySimulator):
        raise HTTPException(status_code=400, detail="Sector comparison requires multi-car replay")
    result = race.sim.get_sector_comparison(target_driver)
    if not result:
        raise HTTPException(status_code=404, detail=f"No data for {target_driver}")
    return result


# ---- FastF1 Replay ----

@app.get("/sessions/schedule")
def sessions_schedule(year: int = Query(2024, ge=2018, le=2026)):
    try:
        events = get_schedule(year)
        return {"year": year, "events": events}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sessions/load")
async def sessions_load(year: int = 2024, gp: str = "Bahrain", session_type: str = "R"):
    try:
        info = await asyncio.to_thread(load_f1_session, year, gp, session_type)
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/race/start-replay")
async def race_start_replay(
    year: int = 2024,
    gp: str = "Bahrain",
    session_type: str = "R",
    driver: str = "VER",
    speed: int = Query(1, ge=1, le=100),
    multi_car: bool = False,
):
    if race.running:
        await _stop_race()

    try:
        # Ensure session is loaded (cached after first call)
        session_info = await asyncio.to_thread(load_f1_session, year, gp, session_type)

        # Extract telemetry frames for the requested driver
        frames = await asyncio.to_thread(
            extract_driver_frames, year, gp, session_type, driver
        )
        if not frames:
            raise HTTPException(status_code=400, detail=f"No telemetry for {driver}")

        total_laps = session_info["total_laps"]
        track_key = session_info.get("track_key")

        # Build track info message
        if track_key and track_key in TRACKS:
            t = TRACKS[track_key]
            race.track_info_msg = {
                "type": "track_info",
                "name": t.name, "country": t.country,
                "total_laps": total_laps or t.total_laps,
                "waypoints_xy": t.xy_points,
                "track_width": t.track_width_m,
            }
            race.track_key = track_key
        else:
            # Extract track geometry from the session itself
            try:
                td = await asyncio.to_thread(
                    extract_track_waypoints, year, gp, session_type
                )
                race.track_info_msg = {
                    "type": "track_info",
                    "name": td["name"],
                    "country": td["country"],
                    "total_laps": total_laps or td["total_laps"],
                    "waypoints_xy": td["waypoints_xy"],
                    "track_width": td["track_width"],
                }
            except Exception:
                race.track_info_msg = {}
            race.track_key = f"replay_{gp}".lower().replace(" ", "_")

        race.speed_multiplier = speed
        race.telemetry_log = deque(maxlen=50000)
        race.lap_times = []
        race.last_frame = {}
        race.multi_car = multi_car
        race.drivers_info = [
            {"abbreviation": d["abbreviation"], "name": d["name"],
             "team": d["team"], "number": d["number"]}
            for d in session_info.get("drivers", [])
        ]

        if multi_car:
            all_positions = await asyncio.to_thread(
                extract_all_drivers_positions, year, gp, session_type
            )
            race.sim = MultiCarReplaySimulator(
                frames, total_laps, all_positions, driver
            )
        else:
            race.sim = ReplaySimulator(frames, total_laps)

        race.running = True
        race.task = asyncio.create_task(simulation_loop())

        return {
            "status": "replay_started",
            "driver": driver,
            "track_key": track_key,
            "total_laps": total_laps,
            "total_frames": len(frames),
            "multi_car": multi_car,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---- Chat ----
@app.post("/chat")
async def chat(driver_code: str = "VER", message: str = ""):
    if not chat_rate_limiter.is_allowed(driver_code):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")
    # Strip HTML and validate
    message = re.sub(r"<[^>]+>", "", message).strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message must not be empty")
    if len(message) > config.chat_max_message_length:
        raise HTTPException(status_code=400, detail=f"Message too long (max {config.chat_max_message_length} chars)")
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
    response = await asyncio.to_thread(
        chat_with_engineer,
        user_message=message, driver_code=driver_code,
        base_lap_time=base_lap_time,
        live_context=live_context,
    )
    return {"response": response}

# ---- WebSocket (read-only telemetry broadcast) ----
@app.websocket("/ws/telemetry")
async def ws_telemetry(websocket: WebSocket):
    # Connection limit check
    if len(race.clients) >= config.ws_max_clients:
        await websocket.close(code=1013, reason="Max clients reached")
        return

    await websocket.accept()
    race.clients.append(websocket)
    logger.info(f"WS client connected ({len(race.clients)} total)")

    # If race is already running, send track info and drivers info
    if race.running and race.track_info_msg:
        await websocket.send_json(race.track_info_msg)
    if race.running and race.multi_car and race.drivers_info:
        await websocket.send_json({"type": "drivers_info", "drivers": race.drivers_info})

    try:
        while True:
            try:
                msg = await asyncio.wait_for(
                    websocket.receive_text(), timeout=60.0
                )
                if msg == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # No message received in 60s, send a ping to check liveness
                try:
                    await websocket.send_text("ping")
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WS error: {e}")
    finally:
        if websocket in race.clients:
            race.clients.remove(websocket)
        logger.info(f"WS client disconnected ({len(race.clients)} remaining)")

# ---- Serve Console ----
@app.get("/console")
def console():
    return FileResponse("static/console.html")

@app.get("/")
def root():
    return FileResponse("static/console.html")
