"""HMAC authentication for service-to-service calls (gateway -> AI)."""

from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import HTTPException, Request, status

_TIMESTAMP_HEADER = "x-verity-timestamp"
_SIGNATURE_HEADER = "x-verity-signature"
_MAX_SKEW_SECONDS = 60


def canonical_payload(method: str, path: str, timestamp: str, body_hash: str) -> str:
    return f"{method.upper()}\n{path}\n{timestamp}\n{body_hash}"


def signature_for(secret: str, method: str, path: str, timestamp: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    return hmac.new(
        secret.encode(),
        canonical_payload(method, path, timestamp, body_hash).encode(),
        hashlib.sha256,
    ).hexdigest()


async def require_internal_signature(request: Request) -> None:
    settings = request.app.state.settings
    token = settings.internal_service_token
    if hasattr(token, "get_secret_value"):
        secret = token.get_secret_value()
    else:
        secret = str(token)

    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal authentication is not configured.",
        )

    timestamp = request.headers.get(_TIMESTAMP_HEADER, "")
    provided = request.headers.get(_SIGNATURE_HEADER, "")

    if not timestamp or not provided:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing internal authentication headers.",
        )

    try:
        timestamp_value = int(timestamp)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal authentication timestamp.",
        ) from exc

    if abs(time.time() - timestamp_value) > _MAX_SKEW_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Internal authentication timestamp has expired.",
        )

    body = await request.body()
    expected = signature_for(secret, request.method, request.url.path, timestamp, body)

    if not hmac.compare_digest(expected, provided):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal authentication signature.",
        )
