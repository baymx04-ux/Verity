import time

from fastapi import FastAPI

from app import __version__
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.routers import health


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the AI service app.

    Uvicorn runs this with ``--factory`` so importing the module never requires a
    fully configured environment (tests can pass their own settings).
    """

    resolved = settings or get_settings()
    configure_logging(resolved.log_level)

    app = FastAPI(
        title="Verity AI",
        version=__version__,
        docs_url=None if resolved.is_production else "/docs",
        redoc_url=None,
    )
    app.state.settings = resolved
    app.state.started_at = time.monotonic()
    app.include_router(health.router)

    return app
