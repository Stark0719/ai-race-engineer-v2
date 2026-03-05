"""Tests for track loading and interpolation."""

import math
import pytest
from backend.simulator.tracks import load_all_tracks, TRACKS


class TestLoadAllTracks:
    def test_loads_at_least_one_track(self):
        assert len(TRACKS) >= 1

    def test_tracks_have_required_fields(self):
        for key, t in TRACKS.items():
            assert t.total_laps > 0
            assert t.base_lap_time_sec > 0
            assert len(t.waypoints) > 10
            assert len(t.sector_boundaries) >= 3


class TestTrackInterpolation:
    def test_interpolate_position_returns_tuple(self, sample_track):
        pos = sample_track.interpolate_position(0.5)
        assert isinstance(pos, tuple)
        assert len(pos) == 2

    def test_interpolate_speed_positive(self, sample_track):
        speed = sample_track.interpolate_speed(0.25)
        assert speed > 0

    def test_get_sector_in_range(self, sample_track):
        for frac in [0.0, 0.1, 0.35, 0.67, 0.99]:
            sector = sample_track.get_sector(frac)
            assert 1 <= sector <= len(sample_track.sector_boundaries) - 1

    def test_get_heading_returns_number(self, sample_track):
        heading = sample_track.get_heading(0.5)
        assert isinstance(heading, float)

    def test_heading_wraps_correctly(self, sample_track):
        h1 = sample_track.get_heading(0.0)
        h2 = sample_track.get_heading(0.999)
        # Both should be finite floats
        assert math.isfinite(h1)
        assert math.isfinite(h2)
