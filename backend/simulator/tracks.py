"""
Track Profiles — Loads Real Circuit Data from JSON
====================================================
Reads circuit coordinates extracted from FastF1 GPS telemetry.
Each circuit stored as data/tracks/<key>.json.

Run scripts/extract_tracks.py first to generate track data.
"""

import json
import math
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple


@dataclass
class TrackProfile:
    key: str
    name: str
    country: str
    total_laps: int
    pit_loss_sec: float
    base_lap_time_sec: float
    safety_car_probability: float
    circuit_length_m: float
    sector_boundaries: List[float]
    waypoints: List[List[float]]  # [[x, y, speed_kph, heading_rad], ...]
    corners: List[dict]
    bounds: dict
    track_width_m: float = 12.0

    @property
    def xy_points(self) -> List[Tuple[float, float]]:
        return [(w[0], w[1]) for w in self.waypoints]

    @property
    def speeds(self) -> List[float]:
        return [w[2] for w in self.waypoints]

    def interpolate_position(self, f: float) -> Tuple[float, float]:
        n = len(self.waypoints) - 1
        f = f % 1.0
        idx = f * n
        i0 = int(idx) % n
        i1 = (i0 + 1) % n
        t = idx - int(idx)
        return (
            self.waypoints[i0][0] * (1 - t) + self.waypoints[i1][0] * t,
            self.waypoints[i0][1] * (1 - t) + self.waypoints[i1][1] * t,
        )

    def interpolate_speed(self, f: float) -> float:
        n = len(self.waypoints) - 1
        f = f % 1.0
        idx = f * n
        i0 = int(idx) % n
        i1 = (i0 + 1) % n
        t = idx - int(idx)
        return self.waypoints[i0][2] * (1 - t) + self.waypoints[i1][2] * t

    def get_sector(self, f: float) -> int:
        f = f % 1.0
        for i in range(len(self.sector_boundaries) - 1):
            if f < self.sector_boundaries[i + 1]:
                return i + 1
        return len(self.sector_boundaries) - 1

    def get_heading(self, f: float) -> float:
        n = len(self.waypoints) - 1
        f = f % 1.0
        idx = f * n
        i0 = int(idx) % n
        i1 = (i0 + 1) % n
        t = idx - int(idx)
        h0 = self.waypoints[i0][3]
        h1 = self.waypoints[i1][3]
        # Handle angle wrapping across ±π boundary
        diff = h1 - h0
        if diff > math.pi:
            diff -= 2 * math.pi
        elif diff < -math.pi:
            diff += 2 * math.pi
        return h0 + diff * t

    def to_api_dict(self) -> dict:
        """Serialize for API response (without full waypoint data for listing)."""
        return {
            "key": self.key,
            "name": self.name,
            "country": self.country,
            "total_laps": self.total_laps,
            "pit_loss": self.pit_loss_sec,
            "base_lap_time": self.base_lap_time_sec,
            "safety_car_prob": self.safety_car_probability,
            "circuit_length_m": self.circuit_length_m,
            "sector_boundaries": self.sector_boundaries,
            "n_waypoints": len(self.waypoints),
            "n_corners": len(self.corners),
            "bounds": self.bounds,
        }

    def to_full_dict(self) -> dict:
        """Full serialization including waypoints (for track rendering)."""
        d = self.to_api_dict()
        d["waypoints_xy"] = self.xy_points
        d["waypoints"] = self.waypoints
        d["corners"] = self.corners
        d["speeds"] = self.speeds
        d["headings"] = [w[3] for w in self.waypoints]
        d["track_width"] = self.track_width_m
        return d


def load_track_from_json(filepath: Path) -> Optional[TrackProfile]:
    """Load a single track from its JSON file."""
    try:
        with open(filepath) as f:
            data = json.load(f)
        return TrackProfile(
            key=data["key"],
            name=data["name"],
            country=data["country"],
            total_laps=data["total_laps"],
            pit_loss_sec=data["pit_loss_sec"],
            base_lap_time_sec=data["base_lap_time_sec"],
            safety_car_probability=data["safety_car_probability"],
            circuit_length_m=data["circuit_length_m"],
            sector_boundaries=data["sector_boundaries"],
            waypoints=data["waypoints"],
            corners=data.get("corners", []),
            bounds=data.get("bounds", {}),
        )
    except Exception as e:
        print(f"Error loading track {filepath}: {e}")
        return None


def load_all_tracks(data_dir: str = "data/tracks") -> Dict[str, TrackProfile]:
    """Load all track JSON files from the data directory."""
    tracks = {}
    track_dir = Path(data_dir)

    if not track_dir.exists():
        print(f"Track data directory not found: {track_dir}")
        print("Run: python scripts/extract_tracks.py")
        return tracks

    for json_file in sorted(track_dir.glob("*.json")):
        if json_file.name == "manifest.json":
            continue
        track = load_track_from_json(json_file)
        if track:
            tracks[track.key] = track
            print(f"  Loaded: {track.name} ({len(track.waypoints)} pts, {track.circuit_length_m:.0f}m)")

    if not tracks:
        print("No track data found. Run: python scripts/extract_tracks.py")

    return tracks


# Load tracks at module import time
TRACKS: Dict[str, TrackProfile] = load_all_tracks()
