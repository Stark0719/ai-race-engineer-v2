"""
FastF1 Session Loader
=====================
Loads real F1 telemetry data from the FastF1 library for replay.
Handles session caching, driver telemetry extraction, and track matching.
"""

import fastf1
import numpy as np
import pandas as pd
import math
import time as time_mod
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# FastF1 disk cache
CACHE_DIR = Path("cache/fastf1")
CACHE_DIR.mkdir(parents=True, exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE_DIR))

# In-memory caches
_session_cache: dict = {}
_frames_cache: dict = {}

# Map FastF1 circuit identifiers → our track keys (from data/tracks/*.json)
_CIRCUIT_MAP = {
    "bahrain": "bahrain",
    "sakhir": "bahrain",
    "baku": "baku",
    "azerbaijan": "baku",
    "barcelona": "barcelona",
    "spain": "barcelona",
    "spanish": "barcelona",
    "cota": "cota",
    "austin": "cota",
    "united states": "cota",
    "hungaroring": "hungaroring",
    "hungarian": "hungaroring",
    "hungary": "hungaroring",
    "imola": "imola",
    "emilia": "imola",
    "interlagos": "interlagos",
    "brazil": "interlagos",
    "são paulo": "interlagos",
    "sao paulo": "interlagos",
    "jeddah": "jeddah",
    "saudi": "jeddah",
    "las vegas": "las_vegas",
    "lusail": "lusail",
    "qatar": "lusail",
    "melbourne": "melbourne",
    "australia": "melbourne",
    "mexico": "mexico_city",
    "hermanos": "mexico_city",
    "miami": "miami",
    "monaco": "monaco",
    "monte-carlo": "monaco",
    "montreal": "montreal",
    "canada": "montreal",
    "canadian": "montreal",
    "monza": "monza",
    "italian": "monza",
    "shanghai": "shanghai",
    "china": "shanghai",
    "chinese": "shanghai",
    "silverstone": "silverstone",
    "british": "silverstone",
    "singapore": "singapore",
    "marina bay": "singapore",
    "spa": "spa",
    "belgian": "spa",
    "spielberg": "spielberg",
    "austria": "spielberg",
    "red bull ring": "spielberg",
    "suzuka": "suzuka",
    "japan": "suzuka",
    "japanese": "suzuka",
    "yas marina": "yas_marina",
    "abu dhabi": "yas_marina",
    "zandvoort": "zandvoort",
    "dutch": "zandvoort",
    "netherlands": "zandvoort",
}


def _match_track_key(event_name: str, location: str) -> Optional[str]:
    """Try to match a FastF1 event to one of our track keys."""
    for text in [event_name.lower(), location.lower()]:
        for keyword, key in _CIRCUIT_MAP.items():
            if keyword in text:
                return key
    return None


def _to_seconds(time_series) -> np.ndarray:
    """Safely convert a FastF1 Time column to a float-seconds array."""
    try:
        return time_series.dt.total_seconds().values.astype(float)
    except AttributeError:
        return np.array([
            t.total_seconds() if hasattr(t, "total_seconds") else float(t) / 1e9
            for t in time_series
        ], dtype=float)


def get_schedule(year: int) -> list[dict]:
    """Return the F1 race schedule for *year*."""
    schedule = fastf1.get_event_schedule(year)
    events = []
    for _, row in schedule.iterrows():
        fmt = str(row.get("EventFormat", ""))
        if fmt == "testing":
            continue
        round_num = int(row["RoundNumber"])
        if round_num == 0:
            continue
        name = str(row["EventName"])
        country = str(row.get("Country", ""))
        location = str(row.get("Location", ""))
        track_key = _match_track_key(name, location)
        events.append({
            "round": round_num,
            "name": name,
            "country": country,
            "location": location,
            "date": str(row.get("EventDate", "")),
            "track_key": track_key,
        })
    return events


def load_session(year: int, gp: str, session_type: str = "R") -> dict:
    """
    Download / cache a FastF1 session and return metadata + driver list.
    This is the potentially slow step (network download on first call).
    """
    cache_key = f"{year}_{gp}_{session_type}"

    if cache_key not in _session_cache:
        logger.info("Loading FastF1 session: %s %s %s", year, gp, session_type)
        session = fastf1.get_session(year, gp, session_type)
        session.load(telemetry=True, weather=False, messages=False)
        _session_cache[cache_key] = session
        logger.info("Session loaded: %s", session.event["EventName"])

    session = _session_cache[cache_key]

    drivers = []
    for drv_num in session.drivers:
        try:
            drv = session.get_driver(drv_num)
            drivers.append({
                "number": int(drv_num),
                "abbreviation": str(drv["Abbreviation"]),
                "name": f"{drv['FirstName']} {drv['LastName']}",
                "team": str(drv.get("TeamName", "")),
            })
        except Exception:
            continue

    if hasattr(session, "total_laps") and session.total_laps:
        total_laps = int(session.total_laps)
    else:
        total_laps = int(session.laps["LapNumber"].max()) if not session.laps.empty else 0

    event_name = str(session.event.get("EventName", ""))
    location = str(session.event.get("Location", ""))
    track_key = _match_track_key(event_name, location)

    return {
        "year": year,
        "gp": gp,
        "session_type": session_type,
        "event_name": event_name,
        "location": location,
        "total_laps": total_laps,
        "drivers": drivers,
        "track_key": track_key,
        "cache_key": cache_key,
    }


def extract_driver_frames(
    year: int,
    gp: str,
    session_type: str,
    driver_abbrev: str,
    target_hz: int = 20,
) -> list[dict]:
    """
    Extract telemetry frames for *driver_abbrev* at *target_hz*.
    Returns a list of dicts whose keys match :class:`TelemetryFrame` fields
    (plus ``total_race_time`` for replay indexing).
    """
    cache_key = f"{year}_{gp}_{session_type}"
    frames_key = f"{cache_key}_{driver_abbrev}_{target_hz}"

    if frames_key in _frames_cache:
        return _frames_cache[frames_key]

    # Ensure session is loaded
    if cache_key not in _session_cache:
        load_session(year, gp, session_type)
    session = _session_cache[cache_key]

    laps = session.laps.pick_drivers(driver_abbrev)
    laps = laps[laps["LapTime"].notna()]          # only complete laps
    laps = laps.sort_values("LapNumber")
    if laps.empty:
        raise ValueError(f"No completed laps for driver {driver_abbrev}")

    frames: list[dict] = []
    total_race_time = 0.0
    last_lap_time = 0.0
    fuel_kg = 110.0
    prev_x, prev_y = 0.0, 0.0
    prev_heading = 0.0
    prev_compound = "medium"

    for _, lap in laps.iterrows():
        lap_num = int(lap["LapNumber"])

        # --- compound ---
        compound = str(lap.get("Compound", "MEDIUM")).lower()
        if compound not in ("soft", "medium", "hard"):
            compound = prev_compound
        prev_compound = compound

        tyre_age = int(lap.get("TyreLife", 1)) if pd.notna(lap.get("TyreLife")) else 1

        lap_time_s = lap["LapTime"].total_seconds()

        # --- sector times ---
        s1_s = lap["Sector1Time"].total_seconds() if pd.notna(lap.get("Sector1Time")) else 0.0
        s2_s = lap["Sector2Time"].total_seconds() if pd.notna(lap.get("Sector2Time")) else 0.0
        s3_s = lap["Sector3Time"].total_seconds() if pd.notna(lap.get("Sector3Time")) else 0.0

        position = int(lap["Position"]) if pd.notna(lap.get("Position")) else 1
        is_pit_in = pd.notna(lap.get("PitInTime"))
        is_pit_out = pd.notna(lap.get("PitOutTime"))

        # --- per-sample telemetry ---
        try:
            tel = lap.get_telemetry()
        except Exception as exc:
            logger.warning("Lap %d telemetry failed: %s", lap_num, exc)
            total_race_time += lap_time_s
            last_lap_time = lap_time_s
            fuel_kg = max(0, fuel_kg - 1.75)
            continue

        if tel is None or tel.empty:
            total_race_time += lap_time_s
            last_lap_time = lap_time_s
            fuel_kg = max(0, fuel_kg - 1.75)
            continue

        # time array (seconds from lap start)
        if "Time" in tel.columns:
            tel_times = _to_seconds(tel["Time"])
            tel_times = tel_times - tel_times[0]  # normalise to 0-based
        else:
            tel_times = np.linspace(0, lap_time_s, len(tel))

        speeds   = tel["Speed"].values   if "Speed"    in tel.columns else np.full(len(tel), 200.0)
        rpms     = tel["RPM"].values     if "RPM"      in tel.columns else np.full(len(tel), 10000.0)
        gears    = tel["nGear"].values   if "nGear"    in tel.columns else np.full(len(tel), 4)
        throtts  = tel["Throttle"].values if "Throttle" in tel.columns else np.full(len(tel), 50.0)
        brks     = tel["Brake"].values   if "Brake"    in tel.columns else np.zeros(len(tel))
        drs_arr  = tel["DRS"].values     if "DRS"      in tel.columns else np.zeros(len(tel))
        x_arr    = tel["X"].values       if "X"        in tel.columns else np.zeros(len(tel))
        y_arr    = tel["Y"].values       if "Y"        in tel.columns else np.zeros(len(tel))

        dt = 1.0 / target_hz
        n_samples = max(1, int(lap_time_s * target_hz))

        for i in range(n_samples):
            t = i * dt
            if t > lap_time_s:
                break
            lap_frac = min(t / lap_time_s, 0.999) if lap_time_s > 0 else 0.0

            idx = int(np.searchsorted(tel_times, t, side="right")) - 1
            idx = max(0, min(idx, len(tel) - 1))

            speed = float(speeds[idx])
            rpm_val = float(rpms[idx])
            gear = int(gears[idx])
            throttle = max(0.0, min(1.0, float(throtts[idx]) / 100.0))
            brake_raw = float(brks[idx])
            brake = max(0.0, min(1.0, brake_raw / 100.0 if brake_raw > 1.0 else brake_raw))
            drs = int(drs_arr[idx]) >= 10

            x = float(x_arr[idx])
            y = float(y_arr[idx])

            # heading from consecutive positions
            dx = x - prev_x
            dy = y - prev_y
            if abs(dx) > 0.5 or abs(dy) > 0.5:
                new_h = math.atan2(dy, dx)
                diff = new_h - prev_heading
                if diff > math.pi:
                    diff -= 2 * math.pi
                if diff < -math.pi:
                    diff += 2 * math.pi
                prev_heading += diff * 0.7
            heading = prev_heading
            prev_x, prev_y = x, y

            # sector
            sector = 1
            if s1_s > 0 and s2_s > 0 and s3_s > 0:
                if t < s1_s:
                    sector = 1
                elif t < s1_s + s2_s:
                    sector = 2
                else:
                    sector = 3

            tyre_wear = min(1.0, tyre_age * {"soft": 0.08, "medium": 0.03, "hard": 0.015}.get(compound, 0.03) / 3.0)
            in_pit = (is_pit_out and lap_frac < 0.05) or (is_pit_in and lap_frac > 0.95)

            frames.append({
                "timestamp": 0,
                "lap_number": lap_num,
                "lap_fraction": round(lap_frac, 4),
                "sector": sector,
                "speed_kph": round(max(0, speed), 1),
                "throttle": round(throttle, 3),
                "brake": round(brake, 3),
                "gear": max(1, min(8, gear)),
                "rpm": round(max(0, rpm_val), 0),
                "drs": drs,
                "fuel_remaining_kg": round(fuel_kg, 2),
                "tyre_compound": compound,
                "tyre_age_laps": tyre_age,
                "tyre_temp_c": 95.0,
                "tyre_wear_pct": round(tyre_wear, 3),
                "current_lap_time": round(t, 3),
                "last_lap_time": round(last_lap_time, 3),
                "sector_1_time": round(s1_s, 3),
                "sector_2_time": round(s2_s, 3),
                "sector_3_time": round(s3_s, 3),
                "x": round(x, 1),
                "y": round(y, 1),
                "heading": round(heading, 4),
                "gap_to_leader": round(max(0, (position - 1) * 1.0), 1),
                "safety_car": False,
                "in_pit": in_pit,
                "total_race_time": round(total_race_time + t, 3),
                "position": position,
            })

        total_race_time += lap_time_s
        last_lap_time = lap_time_s
        fuel_kg = max(0, fuel_kg - 1.75)

    _frames_cache[frames_key] = frames
    logger.info("Extracted %d frames for %s (%d laps)", len(frames), driver_abbrev, len(laps))
    return frames


def extract_track_waypoints(year: int, gp: str, session_type: str = "R") -> dict:
    """
    Build minimal track geometry from the fastest lap's position data.
    Used when we don't have pre-extracted track data for this circuit.
    """
    cache_key = f"{year}_{gp}_{session_type}"
    if cache_key not in _session_cache:
        load_session(year, gp, session_type)
    session = _session_cache[cache_key]

    fastest = session.laps.pick_fastest()
    if fastest is None:
        raise ValueError("No fastest lap available")

    tel = fastest.get_telemetry()
    if tel is None or tel.empty:
        raise ValueError("No telemetry for fastest lap")

    x_vals = tel["X"].values if "X" in tel.columns else np.array([])
    y_vals = tel["Y"].values if "Y" in tel.columns else np.array([])
    if len(x_vals) == 0:
        raise ValueError("No position data available")

    step = max(1, len(x_vals) // 600)
    indices = range(0, len(x_vals), step)
    waypoints_xy = [[float(x_vals[i]), float(y_vals[i])] for i in indices]

    lt = fastest.get("LapTime")
    s1 = fastest.get("Sector1Time")
    s2 = fastest.get("Sector2Time")
    if pd.notna(s1) and pd.notna(s2) and pd.notna(lt):
        lt_s = lt.total_seconds()
        sector_boundaries = [
            0.0,
            round(s1.total_seconds() / lt_s, 4),
            round((s1.total_seconds() + s2.total_seconds()) / lt_s, 4),
            1.0,
        ]
    else:
        sector_boundaries = [0.0, 0.333, 0.667, 1.0]

    total_laps = int(session.total_laps) if hasattr(session, "total_laps") and session.total_laps else 0

    return {
        "waypoints_xy": waypoints_xy,
        "track_width": 12.0,
        "sector_boundaries": sector_boundaries,
        "name": str(session.event.get("EventName", gp)),
        "country": str(session.event.get("Country", "")),
        "total_laps": total_laps,
    }


_POSITION_FIELDS = (
    "total_race_time", "x", "y", "heading", "lap_fraction",
    "lap_number", "speed_kph", "position", "tyre_compound", "in_pit",
    "last_lap_time", "sector_1_time", "sector_2_time", "sector_3_time",
)


def extract_all_drivers_positions(
    year: int,
    gp: str,
    session_type: str,
    target_hz: int = 4,
) -> dict[str, list[dict]]:
    """
    Extract position-only frames at *target_hz* for **all** drivers in a session.
    Returns ``{driver_abbrev: [position_dict, ...]}``.
    """
    cache_key = f"{year}_{gp}_{session_type}"
    positions_key = f"{cache_key}_all_positions_{target_hz}"

    if positions_key in _frames_cache:
        return _frames_cache[positions_key]

    if cache_key not in _session_cache:
        load_session(year, gp, session_type)
    session = _session_cache[cache_key]

    all_positions: dict[str, list[dict]] = {}
    total_drivers = len(session.drivers)

    for i, drv_num in enumerate(session.drivers, 1):
        try:
            drv = session.get_driver(drv_num)
            abbrev = str(drv["Abbreviation"])
        except Exception:
            continue

        logger.info("Extracting positions for %s (%d/%d)", abbrev, i, total_drivers)

        try:
            frames = extract_driver_frames(
                year, gp, session_type, abbrev, target_hz=target_hz,
            )
            all_positions[abbrev] = [
                {k: f[k] for k in _POSITION_FIELDS} for f in frames
            ]
        except Exception as exc:
            logger.warning("Position extraction failed for %s: %s", abbrev, exc)
            continue

    _frames_cache[positions_key] = all_positions
    logger.info("Extracted positions for %d drivers", len(all_positions))
    return all_positions
