from pydantic import Field, SecretStr
from workplace_platform.config import ServiceSettings


class UsersSettings(ServiceSettings):
    database_url: str
    service_name: str = "users"
    mcp_access_ttl_seconds: int = Field(default=600, ge=60, le=3600)
    mcp_refresh_days: int = Field(default=30, ge=1, le=365)
    mcp_encryption_key: SecretStr | None = Field(default=None, min_length=32)
