import pytest
from app.core.config import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        log_level="warning",
        verity_app_password="test-password",
    )
