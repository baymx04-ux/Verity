from functools import lru_cache
from urllib.parse import quote

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed settings for the AI service."""

    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "verity-ai"
    environment: str = "development"
    log_level: str = "info"

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "verity"
    verity_app_user: str = "verity_app"
    verity_app_password: SecretStr

    redis_url: str = "redis://localhost:6379"

    minio_endpoint: str = "localhost"
    minio_port: int = 9000
    minio_use_ssl: bool = False
    minio_access_key: str = ""
    minio_secret_key: SecretStr = SecretStr("")
    minio_bucket: str = "verity-docs"

    internal_service_token: SecretStr = SecretStr("")

    llm_provider: str = "google"
    llm_model: str = "gemini-2.5-flash"
    llm_temperature: float = 0.1
    llm_max_output_tokens: int = 1200
    google_api_key: SecretStr = SecretStr("")
    google_ai_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    anthropic_api_key: SecretStr = SecretStr("")
    openai_api_key: SecretStr = SecretStr("")
    ollama_base_url: str = "http://localhost:11434"

    embedding_provider: str = "google"
    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 768
    embedding_batch_size: int = 16
    embedding_cache_ttl_seconds: int = 60 * 60 * 24 * 7

    retrieve_top_k: int = 30
    rerank_top_n: int = 6
    min_rerank_score: float = 0.25
    reranker: str = "none"
    rerank_model: str = "rerank-v3.5"
    cohere_api_key: SecretStr = SecretStr("")
    chat_history_limit: int = 20

    chunk_tokens: int = 650
    chunk_overlap: int = 100
    ingest_max_mb: int = 25

    @property
    def database_url(self) -> str:
        user = quote(self.verity_app_user, safe="")
        password = quote(self.verity_app_password.get_secret_value(), safe="")
        return (
            f"postgresql://{user}:{password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def minio_url(self) -> str:
        scheme = "https" if self.minio_use_ssl else "http"
        return f"{scheme}://{self.minio_endpoint}:{self.minio_port}"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    """Return a cached settings instance for the service process."""

    return Settings()
