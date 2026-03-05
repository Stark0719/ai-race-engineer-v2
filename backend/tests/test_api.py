"""Tests for API endpoints (using FastAPI TestClient)."""

import pytest
from fastapi.testclient import TestClient
from backend.api.main import app


@pytest.fixture
def client():
    return TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestDriversEndpoint:
    def test_returns_driver_list(self, client):
        resp = client.get("/drivers")
        assert resp.status_code == 200
        assert "drivers" in resp.json()
        assert len(resp.json()["drivers"]) > 0


class TestTracksEndpoint:
    def test_returns_tracks(self, client):
        resp = client.get("/tracks")
        assert resp.status_code == 200
        assert "tracks" in resp.json()
        tracks = resp.json()["tracks"]
        assert len(tracks) > 0
        # Check first track has required fields
        first = next(iter(tracks.values()))
        assert "total_laps" in first
        assert "base_lap_time" in first


class TestRaceStateEndpoint:
    def test_race_state_when_idle(self, client):
        resp = client.get("/race/state")
        assert resp.status_code == 200
        data = resp.json()
        assert "running" in data


class TestRecommendEndpoint:
    def test_recommend_valid_driver(self, client):
        resp = client.post("/recommend?driver_code=VER&iterations=30")
        assert resp.status_code == 200
        data = resp.json()
        assert "recommended" in data
        assert data["recommended"] in ("1-stop", "2-stop")

    def test_recommend_invalid_driver(self, client):
        resp = client.post("/recommend?driver_code=XXX&iterations=30")
        assert resp.status_code == 400


class TestChatEndpoint:
    def test_chat_empty_message(self, client):
        resp = client.post("/chat?driver_code=VER&message=")
        assert resp.status_code == 400


class TestRaceStartEndpoint:
    def test_start_invalid_track(self, client):
        resp = client.post("/race/start?track=nonexistent")
        data = resp.json()
        assert "error" in data

    def test_pit_invalid_compound(self, client):
        resp = client.post("/race/pit?compound=ultrasoft")
        assert resp.status_code == 400
