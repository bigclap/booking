from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class ServiceSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str | None = None
    database_password: SecretStr | None = None
    nats_url: str = "nats://nats:4222"
    internal_rpc_enabled: bool = False
    booking_url: str = "http://booking:8000"
    assistant_url: str = "http://assistant:8000"
    internal_api_key: SecretStr = Field(min_length=24)
    users_url: str = "http://users:8000"
    request_timeout_seconds: float = Field(default=5, gt=0, le=120)
    service_name: str = "service"
    public_base_url: str = "http://localhost:5178"
    web_jwt_secret: SecretStr | None = Field(default=None, min_length=32)
    web_jwt_issuer: str = "workplace-users"
    web_jwt_audience: str = "workplace-web"

    @model_validator(mode="after")
    def service_origins(self):
        for name in ("users_url", "booking_url", "assistant_url"):
            value = urlsplit(getattr(self, name))
            if (
                value.scheme not in {"http", "https"}
                or not value.hostname
                or value.username
                or value.password
                or value.query
                or value.fragment
                or value.path not in {"", "/"}
            ):
                raise ValueError(f"{name.upper()} must be an HTTP(S) origin without a path")
            setattr(self, name, getattr(self, name).rstrip("/"))
        return self

    @model_validator(mode="after")
    def database_credentials(self):
        public = urlsplit(self.public_base_url)
        if (
            public.scheme not in {"http", "https"}
            or not public.netloc
            or public.username
            or public.password
            or public.query
            or public.fragment
            or public.path not in {"", "/"}
        ):
            raise ValueError("PUBLIC_BASE_URL must be an HTTP(S) origin without a path")
        self.public_base_url = self.public_base_url.rstrip("/")
        # URL.create/set percent-encodes passwords containing @, /, %, etc.
        if self.database_url and self.database_password is not None:
            self.database_url = (
                make_url(self.database_url)
                .set(password=self.database_password.get_secret_value())
                .render_as_string(hide_password=False)
            )
        return self
