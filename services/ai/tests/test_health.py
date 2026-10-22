from app.core.config import Settings
from app.main import create_app
from app.routers import health
from fastapi.testclient import TestClient
from pytest import MonkeyPatch


def test_health_reports_ok(monkeypatch: MonkeyPatch, settings: Settings) -> None:
    async def fake_check(_settings: Settings) -> dict[str, health.DependencyStatus]:
        return {"postgres": "ok", "redis": "ok", "minio": "ok"}

    monkeypatch.setattr(health, "check_dependencies", fake_check)

    with TestClient(create_app(settings)) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["version"] == "0.1.0"
    assert response.json()["dependencies"] == {
        "postgres": "ok",
        "redis": "ok",
        "minio": "ok",
    }


def test_health_reports_degraded(monkeypatch: MonkeyPatch, settings: Settings) -> None:
    async def fake_check(_settings: Settings) -> dict[str, health.DependencyStatus]:
        return {"postgres": "ok", "redis": "down", "minio": "ok"}

    monkeypatch.setattr(health, "check_dependencies", fake_check)

    with TestClient(create_app(settings)) as client:
        response = client.get("/health")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["dependencies"]["redis"] == "down"


def test_health_is_the_only_public_route(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        response = client.get("/chat")

    assert response.status_code == 404
