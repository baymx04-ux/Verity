from app.core.config import Settings


def test_database_url_quotes_credentials() -> None:
    settings = Settings(
        _env_file=None,
        verity_app_user="verity_app",
        verity_app_password="p@ss word",
        postgres_host="db",
        postgres_port=5433,
        postgres_db="verity",
    )

    assert settings.database_url == "postgresql://verity_app:p%40ss%20word@db:5433/verity"


def test_minio_url_respects_tls() -> None:
    settings = Settings(
        _env_file=None,
        verity_app_password="test-password",
        minio_endpoint="objects",
        minio_port=9443,
        minio_use_ssl=True,
    )

    assert settings.minio_url == "https://objects:9443"


def test_production_disables_docs() -> None:
    settings = Settings(
        _env_file=None,
        environment="production",
        verity_app_password="test-password",
    )

    assert settings.is_production is True
