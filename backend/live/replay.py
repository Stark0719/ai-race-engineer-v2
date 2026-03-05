"""
Replay Simulator
================
Plays back pre-extracted FastF1 telemetry frames through the same
broadcast pipeline used by the live car simulator.
"""

import time as time_mod
from backend.live.car_simulator import TelemetryFrame


class ReplaySimulator:
    """
    Iterates through a list of pre-extracted frame dicts, advancing by
    simulation time.  Implements the same interface as LiveCarSimulator
    so that ``simulation_loop`` can drive it identically.
    """

    def __init__(self, frames: list[dict], total_laps: int):
        if not frames:
            raise ValueError("No frames to replay")
        self.frames = frames
        self.total_laps = total_laps
        self.current_time = 0.0
        self.frame_index = 0
        self.pit_history: list[dict] = self._detect_pit_stops()

    # ------------------------------------------------------------------
    # Properties expected by simulation_loop / race-finish logic
    # ------------------------------------------------------------------

    @property
    def lap_number(self) -> int:
        if 0 <= self.frame_index < len(self.frames):
            return self.frames[self.frame_index]["lap_number"]
        return self.total_laps + 1

    @property
    def total_race_time(self) -> float:
        return self.current_time

    # ------------------------------------------------------------------
    # Core interface
    # ------------------------------------------------------------------

    def tick(self, dt_sim: float, real_dt: float = 0.1):
        """Advance replay clock by *dt_sim* seconds (already scaled)."""
        self.current_time += dt_sim
        while (
            self.frame_index < len(self.frames) - 1
            and self.frames[self.frame_index + 1]["total_race_time"] <= self.current_time
        ):
            self.frame_index += 1

    def generate_frame(self) -> TelemetryFrame:
        idx = max(0, min(self.frame_index, len(self.frames) - 1))
        fd = self.frames[idx]
        return TelemetryFrame(
            timestamp=time_mod.time(),
            lap_number=fd["lap_number"],
            lap_fraction=fd["lap_fraction"],
            sector=fd["sector"],
            speed_kph=fd["speed_kph"],
            throttle=fd["throttle"],
            brake=fd["brake"],
            gear=fd["gear"],
            rpm=fd["rpm"],
            drs=fd["drs"],
            fuel_remaining_kg=fd["fuel_remaining_kg"],
            tyre_compound=fd["tyre_compound"],
            tyre_age_laps=fd["tyre_age_laps"],
            tyre_temp_c=fd["tyre_temp_c"],
            tyre_wear_pct=fd["tyre_wear_pct"],
            current_lap_time=fd["current_lap_time"],
            last_lap_time=fd["last_lap_time"],
            sector_1_time=fd["sector_1_time"],
            sector_2_time=fd["sector_2_time"],
            sector_3_time=fd["sector_3_time"],
            x=fd["x"],
            y=fd["y"],
            heading=fd["heading"],
            gap_to_leader=fd["gap_to_leader"],
            safety_car=fd["safety_car"],
            in_pit=fd["in_pit"],
            total_race_time=fd["total_race_time"],
            position=fd["position"],
        )

    def is_race_finished(self) -> bool:
        return self.frame_index >= len(self.frames) - 1

    # unused by replay but keeps the interface consistent
    def pit_stop(self, new_compound: str):
        pass

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _detect_pit_stops(self) -> list[dict]:
        pits: list[dict] = []
        was_in_pit = False
        for f in self.frames:
            if f.get("in_pit") and not was_in_pit:
                pits.append({"lap": f["lap_number"], "compound": f["tyre_compound"]})
            was_in_pit = bool(f.get("in_pit"))
        return pits


class MultiCarReplaySimulator:
    """
    Wraps a ``ReplaySimulator`` for the focused driver and synchronises
    position-only data (4 Hz) for every other driver on track.
    """

    def __init__(
        self,
        focused_frames: list[dict],
        total_laps: int,
        all_positions: dict[str, list[dict]],
        focused_driver: str,
    ):
        self._inner = ReplaySimulator(focused_frames, total_laps)
        self._focused_driver = focused_driver
        # Remove focused driver from ghost positions
        self._all_positions: dict[str, list[dict]] = {
            k: v for k, v in all_positions.items() if k != focused_driver
        }
        self._pos_indices: dict[str, int] = {k: 0 for k in self._all_positions}

    # ------------------------------------------------------------------
    # Delegate core interface to inner simulator
    # ------------------------------------------------------------------

    @property
    def lap_number(self) -> int:
        return self._inner.lap_number

    @property
    def total_race_time(self) -> float:
        return self._inner.total_race_time

    @property
    def pit_history(self) -> list[dict]:
        return self._inner.pit_history

    def tick(self, dt_sim: float, real_dt: float = 0.1):
        self._inner.tick(dt_sim, real_dt)
        # Advance ghost car indices to match the current time
        t = self._inner.current_time
        for drv, frames in self._all_positions.items():
            idx = self._pos_indices[drv]
            while (
                idx < len(frames) - 1
                and frames[idx + 1]["total_race_time"] <= t
            ):
                idx += 1
            self._pos_indices[drv] = idx

    def generate_frame(self) -> TelemetryFrame:
        return self._inner.generate_frame()

    def is_race_finished(self) -> bool:
        return self._inner.is_race_finished()

    def pit_stop(self, new_compound: str):
        self._inner.pit_stop(new_compound)

    # ------------------------------------------------------------------
    # Ghost car positions
    # ------------------------------------------------------------------

    def generate_car_positions(self) -> dict[str, dict]:
        """Return current position snapshot for every non-focused driver."""
        out: dict[str, dict] = {}
        for drv, frames in self._all_positions.items():
            idx = self._pos_indices[drv]
            if idx < len(frames):
                out[drv] = frames[idx]
        return out

    def compute_timing_gaps(self) -> list[dict]:
        """Compute gap-to-leader and gap-to-car-ahead for all drivers."""
        idx = max(0, min(self._inner.frame_index, len(self._inner.frames) - 1))
        focused_frame = self._inner.frames[idx]
        entries = [{
            "driver": self._focused_driver,
            "total_race_time": self._inner.current_time,
            "position": focused_frame.get("position", 1),
            "lap_number": focused_frame.get("lap_number", 1),
            "last_lap_time": focused_frame.get("last_lap_time", 0),
        }]

        for drv, frames in self._all_positions.items():
            pos_idx = self._pos_indices[drv]
            if pos_idx < len(frames):
                f = frames[pos_idx]
                entries.append({
                    "driver": drv,
                    "total_race_time": f["total_race_time"],
                    "position": f.get("position", 20),
                    "lap_number": f.get("lap_number", 1),
                    "last_lap_time": f.get("last_lap_time", 0),
                })

        entries.sort(key=lambda e: e["position"])

        gaps = []
        leader_time = entries[0]["total_race_time"] if entries else 0
        for i, e in enumerate(entries):
            gap_to_leader = round(e["total_race_time"] - leader_time, 3) if i > 0 else 0.0
            gap_to_ahead = round(e["total_race_time"] - entries[i - 1]["total_race_time"], 3) if i > 0 else 0.0
            gaps.append({
                "driver": e["driver"],
                "position": e["position"],
                "gap_to_leader": gap_to_leader,
                "gap_to_ahead": gap_to_ahead,
                "lap_number": e["lap_number"],
                "last_lap_time": e["last_lap_time"],
            })
        return gaps

    def get_sector_comparison(self, target_driver: str) -> dict | None:
        """Compare sector times between focused driver and target."""
        idx = max(0, min(self._inner.frame_index, len(self._inner.frames) - 1))
        focused = self._inner.frames[idx]
        if target_driver not in self._all_positions:
            return None
        t_idx = self._pos_indices[target_driver]
        if t_idx >= len(self._all_positions[target_driver]):
            return None
        target = self._all_positions[target_driver][t_idx]

        f_sectors = {
            "s1": focused.get("sector_1_time", 0),
            "s2": focused.get("sector_2_time", 0),
            "s3": focused.get("sector_3_time", 0),
        }
        t_sectors = {
            "s1": target.get("sector_1_time", 0),
            "s2": target.get("sector_2_time", 0),
            "s3": target.get("sector_3_time", 0),
        }
        delta = {
            k: round(f_sectors[k] - t_sectors[k], 3)
            for k in ("s1", "s2", "s3")
        }
        return {
            "focused_driver": self._focused_driver,
            "target_driver": target_driver,
            "focused": f_sectors,
            "target": t_sectors,
            "delta": delta,
        }
