from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StringConstraints,
    TypeAdapter,
    field_validator,
)
from pydantic.alias_generators import to_camel

from workplace_gateway.contracts.internal import InternalUser
from workplace_gateway.upstream import parse_upstream


class PublicModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid", strict=True)


class AppUser(PublicModel):
    id: str
    login: str
    first_name: str
    last_name: str
    role: Literal["employee", "admin"]
    active: bool
    building_ids: list[str]
    created_at: str

    @classmethod
    def from_internal(cls, data: object) -> "AppUser":
        user = parse_upstream(TypeAdapter(InternalUser), data)
        return cls.model_validate(
            {
                "id": str(user.id),
                "login": user.login,
                "firstName": user.first_name,
                "lastName": user.last_name,
                "role": user.role,
                "active": user.active,
                "buildingIds": user.building_ids,
                "createdAt": user.created_at.isoformat()
                if isinstance(user.created_at, datetime)
                else user.created_at,
            }
        )


class AuthSnapshot(PublicModel):
    user: AppUser | None
    users: list[AppUser]
    expires_at: int | None


class LoginInput(PublicModel):
    login: str = Field(min_length=1, max_length=80)
    password: SecretStr = Field(min_length=1, max_length=1024)


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class UserFields(PublicModel):
    login: str
    first_name: Name
    last_name: Name
    role: Literal["employee", "admin"]
    building_ids: list[str] = Field(max_length=1000)

    @field_validator("login")
    @classmethod
    def normalize_login(cls, value: str) -> str:
        import re

        value = value.strip().lower()
        if not re.fullmatch(r"[a-z0-9._-]{3,40}", value):
            raise ValueError("Логин: 3–40 латинских букв, цифр или символов . _ -")
        return value

    @field_validator("building_ids")
    @classmethod
    def normalize_buildings(cls, value: list[str]) -> list[str]:
        if any(not item.strip() or len(item) > 1000 for item in value):
            raise ValueError("Некорректный список зданий")
        return list(dict.fromkeys(item.strip() for item in value))


class UserCreate(UserFields):
    password: SecretStr = Field(min_length=8, max_length=1024)


class UserUpdate(UserFields):
    active: bool


class PasswordChange(PublicModel):
    current: SecretStr = Field(min_length=1, max_length=1024)
    password: SecretStr = Field(min_length=8, max_length=1024)


class PasswordReset(PublicModel):
    password: SecretStr = Field(min_length=8, max_length=1024)
