from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from workplace_platform.config import ServiceSettings


class AssistantSettings(ServiceSettings):
    service_name: str = "assistant"
    openrouter_api_key: SecretStr | None = None
    openrouter_model: str | None = None
    mcp_url: str = "http://gateway:8000/mcp"
    generation_timeout_seconds: float = Field(default=90, gt=0, lt=120)
    generation_provider_timeout_seconds: float = Field(default=60, gt=0, lt=120)
    generation_request_limit: int = Field(default=10, ge=1, le=20)
    generation_tool_calls_limit: int = Field(default=20, ge=1, le=100)
    generation_retry_limit: int = Field(default=1, ge=0, le=3)
    generation_attempt_limit: int = Field(default=3, ge=1, le=10)
    generation_output_token_limit: int = Field(default=4000, ge=128, le=16000)
    generation_message_chars: int = Field(default=8000, ge=256, le=32000)
    generation_history_runs: int = Field(default=6, ge=0, le=100)
    generation_history_chars: int = Field(default=48000, ge=1000, le=500000)

    @field_validator("openrouter_api_key", "openrouter_model", mode="before")
    @classmethod
    def empty_is_unset(cls, value):
        return None if value == "" else value

    @property
    def llm_configured(self) -> bool:
        return bool(self.openrouter_api_key and self.openrouter_model)


def configuration_status(settings: AssistantSettings) -> dict:
    missing = []
    if not settings.openrouter_api_key:
        missing.append("OPENROUTER_API_KEY")
    if not settings.openrouter_model:
        missing.append("OPENROUTER_MODEL")
    if not settings.mcp_url:
        missing.append("MCP_URL")
    return {
        "runtime": "pydantic-ai",
        "model": settings.openrouter_model,
        "llm_configured": settings.llm_configured,
        "generation_available": not missing,
        "missing_configuration": missing,
    }


@lru_cache
def get_settings() -> AssistantSettings:
    return AssistantSettings()
