import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Literal

import httpx
import psycopg
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from app import __version__
from app.core.config import Settings

router = APIRouter(tags=["health"])

DependencyStatus = Literal["ok", "down"]

logger = logging.getLogger(__name__)


async def check_postgres(settings: Settings) -> None:
    async with await psycopg.AsyncConnection.connect(
        settings.database_url, connect_timeout=2
    ) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute("SELECT 1")
            await cursor.fetchone()


async def check_redis(settings: Settings) -> None:
    client = Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=2,
        socket_timeout=2,
    )

    try:
        await client.ping()
    finally:
        await client.aclose()


async def check_minio(settings: Settings) -> None:
    async with httpx.AsyncClient(timeout=2.0) as client:
        response = await client.get(f"{settings.minio_url}/minio/health/live")
        response.raise_for_status()


async def check_dependencies(settings: Settings) -> dict[str, DependencyStatus]:
    """Check every backing service without letting one failure hide the rest."""

    checks: dict[str, Callable[[Settings], Awaitable[None]]] = {
        "postgres": check_postgres,
        "redis": check_redis,
        "minio": check_minio,
    }

    results = await asyncio.gather(
        *(check(settings) for check in checks.values()),
        return_exceptions=True,
    )

    dependencies: dict[str, DependencyStatus] = {}

    for name, result in zip(checks.keys(), results, strict=True):
        if result is None:
            dependencies[name] = "ok"
        else:
            dependencies[name] = "down"
            logger.warning(
                "dependency health check failed",
                extra={"dependency": name, "reason": str(result)},
            )

    return dependencies


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings
    dependencies = await check_dependencies(settings)
    status = "ok" if all(value == "ok" for value in dependencies.values()) else "degraded"
    uptime = int(time.monotonic() - request.app.state.started_at)

    return JSONResponse(
        status_code=200 if status == "ok" else 503,
        content={
            "status": status,
            "version": __version__,
            "uptime_s": uptime,
            "dependencies": dependencies,
        },
    )
