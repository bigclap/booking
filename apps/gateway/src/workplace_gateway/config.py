from pydantic import Field
from workplace_platform.config import ServiceSettings


class GatewaySettings(ServiceSettings):
    booking_url: str = "http://booking:8000"
    assistant_url: str = "http://assistant:8000"
    cookie_name: str = "workplace_access"
    refresh_cookie_name: str = "workplace_refresh"
    cookie_secure: bool = True
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5178"])
