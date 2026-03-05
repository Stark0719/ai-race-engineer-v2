"""
Session Persistence
====================
Save and load race sessions as JSON files for post-race review.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

SESSIONS_DIR = Path("data/sessions")
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class SavedSession:
    id: str
    timestamp: str
    track: str
    driver: str
    mode: str  # "sim" or "replay"
    total_laps: int
    total_time: float
    lap_times: list[dict]
    pit_history: list[dict]
    strategy_result: Optional[dict] = None
    race_decision: Optional[dict] = None


def save_session(session: SavedSession) -> str:
    """Save a session to disk. Returns the session ID."""
    path = SESSIONS_DIR / f"{session.id}.json"
    with open(path, "w") as f:
        json.dump(asdict(session), f, indent=2)
    logger.info("Session saved: %s", session.id)
    return session.id


def load_session(session_id: str) -> Optional[SavedSession]:
    """Load a session by ID. Returns None if not found."""
    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        return None
    with open(path) as f:
        data = json.load(f)
    return SavedSession(**data)


def list_sessions() -> list[dict]:
    """List all saved sessions (summary only)."""
    sessions = []
    for path in sorted(SESSIONS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            with open(path) as f:
                data = json.load(f)
            best_lap = min((lt["time"] for lt in data.get("lap_times", []) if lt.get("time")), default=None)
            sessions.append({
                "id": data["id"],
                "timestamp": data["timestamp"],
                "track": data["track"],
                "driver": data["driver"],
                "mode": data["mode"],
                "total_laps": data["total_laps"],
                "total_time": data["total_time"],
                "best_lap": best_lap,
            })
        except Exception as e:
            logger.warning("Failed to read session %s: %s", path.name, e)
    return sessions


def delete_session(session_id: str) -> bool:
    """Delete a session by ID. Returns True if deleted."""
    path = SESSIONS_DIR / f"{session_id}.json"
    if path.exists():
        path.unlink()
        logger.info("Session deleted: %s", session_id)
        return True
    return False
