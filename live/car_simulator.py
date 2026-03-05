"""
Live Car Simulator v3
=====================
Produces telemetry frames with XY positions and heading angle.
Sub-stepping prevents lap_fraction overshoot.
Tyre temp uses real-time dt.
"""

import time
import random
import math
import numpy as np
from dataclasses import dataclass
from backend.simulator.tracks.profiles import TrackProfile, TRACKS
from backend.simulator.config import COMPOUNDS, SimulationConfig


@dataclass
class TelemetryFrame:
    timestamp: float
    lap_number: int
    lap_fraction: float
    sector: int
    speed_kph: float
    throttle: float
    brake: float
    gear: int
    rpm: float
    drs: bool
    fuel_remaining_kg: float
    tyre_compound: str
    tyre_age_laps: int
    tyre_temp_c: float
    tyre_wear_pct: float
    current_lap_time: float
    last_lap_time: float
    sector_1_time: float
    sector_2_time: float
    sector_3_time: float
    x: float            # Track position X (meters)
    y: float            # Track position Y (meters)
    heading: float      # Heading angle (radians)
    gap_to_leader: float
    safety_car: bool
    in_pit: bool
    total_race_time: float
    position: int


class LiveCarSimulator:

    def __init__(self, track_key: str, compound: str = "medium",
                 driver: str = "VER", config: SimulationConfig = None):
        self.track: TrackProfile = TRACKS[track_key]
        self.config = config or SimulationConfig()
        self.driver = driver
        self.compound = compound
        self.tyre_age_laps = 0
        self.tyre_wear = 0.0
        self.tyre_temp = 70.0
        self.fuel_kg = 110.0
        self.fuel_per_lap_kg = 1.75
        self.lap_number = 1
        self.lap_fraction = 0.0
        self.total_race_time = 0.0
        self.current_lap_elapsed = 0.0
        self.last_lap_time = 0.0
        self.sector_times = [0.0, 0.0, 0.0]
        self.current_sector_start = 0.0
        self.current_sector = 1
        self.safety_car = False
        self.safety_car_laps_remaining = 0
        self.in_pit = False
        self.pit_stop_at_lap = None
        self.next_compound = "hard"
        self.position = random.randint(3, 8)
        self.stint_number = 1
        self.pit_history = []

    def _tyre_degradation_factor(self) -> float:
        c = COMPOUNDS[self.compound]
        age = self.tyre_age_laps
        linear = c["deg"] * age
        co = c.get("cliff_onset", 999)
        cm = c.get("cliff_multiplier", 0.0)
        cliff = cm * max(0, age - co) ** 2 if age > co else 0
        return linear + cliff

    def _fuel_time_benefit(self) -> float:
        return (110.0 - self.fuel_kg) * self.config.fuel_effect

    def _update_tyre_temp(self, speed: float, real_dt: float):
        ambient = 35.0
        heat = (speed / 300.0) * 3.0
        cool = (self.tyre_temp - ambient) * 0.04
        self.tyre_temp += (heat - cool) * real_dt
        self.tyre_temp = float(np.clip(self.tyre_temp, ambient, 130.0))

    def _tyre_temp_factor(self) -> float:
        diff = abs(self.tyre_temp - 95.0)
        return 0.0 if diff < 15 else (diff - 15) * 0.01

    def _predicted_lap_time(self) -> float:
        base = self.track.base_lap_time_sec
        co = COMPOUNDS[self.compound]["pace_offset"]
        deg = self._tyre_degradation_factor()
        fb = self._fuel_time_benefit()
        wu = self.config.warmup_penalty if self.tyre_age_laps <= self.config.warmup_laps else 0
        tp = self._tyre_temp_factor()
        n = random.uniform(-0.2, 0.2)
        if self.safety_car:
            return base + 25.0
        return max(base * 0.9, base + co + deg - fb + wu + tp + n)

    def _compute_speed(self, frac: float) -> float:
        frac = max(0.0, min(frac, 0.999))
        base = self.track.interpolate_speed(frac)
        df = self._tyre_degradation_factor()
        speed = base * (1.0 - df * (0.003 if base < 200 else 0.001))
        speed *= (1.0 + (110.0 - self.fuel_kg) * 0.0003)
        if self.safety_car:
            speed = min(speed, 180.0)
        return max(50.0, speed * random.uniform(0.98, 1.02))

    def _gear(self, s): return min(8, max(1, int(s / 42)))
    def _rpm(self, s, g): return min(15000, (8000 + s / 350 * 7000) * (1 + (8 - g) * 0.08))

    def pit_stop(self, new_compound: str):
        self.pit_history.append({"lap": self.lap_number, "old": self.compound,
                                  "new": new_compound, "age": self.tyre_age_laps})
        self.compound = new_compound
        self.tyre_age_laps = 0
        self.tyre_wear = 0.0
        self.tyre_temp = 65.0
        self.stint_number += 1
        self.in_pit = True

    def generate_frame(self) -> TelemetryFrame:
        frac = max(0.0, min(self.lap_fraction, 0.999))
        pos = self.track.interpolate_position(frac)
        heading = self.track.get_heading(frac)
        speed = self._compute_speed(frac)
        gear = self._gear(speed)
        rpm = self._rpm(speed, gear)

        nf = min(0.999, frac + 0.02)
        ts = self.track.interpolate_speed(nf)
        if ts < speed * 0.9:
            throttle, brake = 0.0, min(1.0, (speed - ts) / 150.0)
        else:
            throttle, brake = min(1.0, 0.5 + speed / 600), 0.0

        return TelemetryFrame(
            timestamp=time.time(), lap_number=self.lap_number,
            lap_fraction=round(frac, 4), sector=self.track.get_sector(frac),
            speed_kph=round(speed, 1), throttle=round(throttle, 3),
            brake=round(brake, 3), gear=gear, rpm=round(rpm, 0),
            drs=speed > 300 and not self.safety_car,
            fuel_remaining_kg=round(self.fuel_kg, 2),
            tyre_compound=self.compound, tyre_age_laps=self.tyre_age_laps,
            tyre_temp_c=round(self.tyre_temp, 1),
            tyre_wear_pct=round(self.tyre_wear, 3),
            current_lap_time=round(self.current_lap_elapsed, 3),
            last_lap_time=round(self.last_lap_time, 3),
            sector_1_time=round(self.sector_times[0], 3),
            sector_2_time=round(self.sector_times[1], 3),
            sector_3_time=round(self.sector_times[2], 3),
            x=round(pos[0], 1), y=round(pos[1], 1),
            heading=round(heading, 4),
            gap_to_leader=round(max(0, (self.position - 1) * random.uniform(0.8, 1.5)), 1),
            safety_car=self.safety_car, in_pit=self.in_pit,
            total_race_time=round(self.total_race_time, 3),
            position=self.position,
        )

    def tick(self, dt_sim: float, real_dt: float = 0.1):
        remaining = dt_sim
        while remaining > 0:
            pl = self._predicted_lap_time()
            fps = 1.0 / pl
            fd = fps * remaining
            fte = 1.0 - self.lap_fraction

            if fd < fte:
                self.lap_fraction += fd
                self.current_lap_elapsed += remaining
                self.total_race_time += remaining
                remaining = 0
            else:
                ttf = fte / fps
                self.current_lap_elapsed += ttf
                self.total_race_time += ttf
                remaining -= ttf

                self.sector_times[self.current_sector - 1] = (
                    self.current_lap_elapsed - self.current_sector_start)
                self.last_lap_time = self.current_lap_elapsed
                self.lap_fraction = 0.0
                self.lap_number += 1
                self.tyre_age_laps += 1
                self.fuel_kg = max(0, self.fuel_kg - self.fuel_per_lap_kg)
                c = COMPOUNDS[self.compound]
                self.tyre_wear = min(1.0, self.tyre_age_laps * c["deg"] / 3.0)

                if self.safety_car:
                    self.safety_car_laps_remaining -= 1
                    if self.safety_car_laps_remaining <= 0:
                        self.safety_car = False
                elif random.random() < self.track.safety_car_probability / self.track.total_laps:
                    self.safety_car = True
                    self.safety_car_laps_remaining = random.randint(2, 5)

                if self.pit_stop_at_lap and self.lap_number == self.pit_stop_at_lap:
                    self.pit_stop(self.next_compound)
                else:
                    self.in_pit = False

                self.current_lap_elapsed = 0.0
                self.current_sector_start = 0.0
                self.current_sector = 1
                self.position = max(1, min(20, self.position + random.randint(-1, 1)))
                if self.is_race_finished():
                    break

        frac = max(0.0, min(self.lap_fraction, 0.999))
        ns = self.track.get_sector(frac)
        if ns != self.current_sector:
            self.sector_times[self.current_sector - 1] = (
                self.current_lap_elapsed - self.current_sector_start)
            self.current_sector_start = self.current_lap_elapsed
            self.current_sector = ns

        speed = self._compute_speed(frac)
        self._update_tyre_temp(speed, real_dt)

    def is_race_finished(self) -> bool:
        return self.lap_number > self.track.total_laps
