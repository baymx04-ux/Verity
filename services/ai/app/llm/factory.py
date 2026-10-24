"""LLM client factory."""

from __future__ import annotations

from app.core.config import Settings
from app.llm.anthropic import AnthropicLLMClient
from app.llm.base import LLMClient
from app.llm.google import GoogleLLMClient
from app.llm.openai import OpenAICompatibleLLMClient


def build_llm_client(settings: Settings) -> LLMClient:
    provider = settings.llm_provider.strip().lower()
    if provider == "google":
        return GoogleLLMClient(settings)
    if provider in {"openai", "ollama"}:
        return OpenAICompatibleLLMClient(settings)
    if provider == "anthropic":
        return AnthropicLLMClient(settings)
    raise ValueError(f"Unsupported LLM provider: {settings.llm_provider}")
