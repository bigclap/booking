from datetime import datetime
from typing import Annotated, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

Password = Annotated[str, Field(min_length=8, max_length=1024)]
Role = Literal["employee", "admin"]
NonNull = TypeVar("NonNull")


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginInput(InputModel):
    login: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=1024)


class TokenInput(InputModel):
    token: str = Field(min_length=1, max_length=256)


class UserCreate(InputModel):
    login: str = Field(min_length=1, max_length=80)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    role: Role = "employee"
    building_ids: list[str] = Field(default_factory=list, max_length=1000)
    password: Password

    @field_validator("login", "first_name", "last_name")
    @classmethod
    def trim_nonempty(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Must not be blank")
        return value

    @field_validator("login")
    @classmethod
    def normalize_login(cls, value: str) -> str:
        normalized = value.casefold()
        if len(normalized) > 80:
            raise ValueError("Login must not exceed 80 characters after normalization")
        return normalized

    @field_validator("building_ids")
    @classmethod
    def normalize_grants(cls, values: list[str]) -> list[str]:
        if any(not value.strip() or len(value) > 1000 for value in values):
            raise ValueError("Invalid building identifier")
        return list(dict.fromkeys(values))


class UserPatch(InputModel):
    login: str | None = Field(default=None, min_length=1, max_length=80)
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    role: Role | None = None
    active: bool | None = None
    building_ids: list[str] | None = Field(default=None, max_length=1000)

    @field_validator("login", "first_name", "last_name")
    @classmethod
    def trim_nonempty(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("Must not be null")
        value = value.strip()
        if not value:
            raise ValueError("Must not be blank")
        return value

    @field_validator("login")
    @classmethod
    def normalize_login(cls, value: str) -> str:
        return UserCreate.normalize_login(value)

    @field_validator("role", "active", "building_ids")
    @classmethod
    def disallow_null(cls, value: NonNull | None) -> NonNull:
        if value is None:
            raise ValueError("Must not be null")
        return value

    @field_validator("building_ids")
    @classmethod
    def normalize_grants(cls, values: list[str]) -> list[str]:
        return UserCreate.normalize_grants(values)


class UserView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    login: str
    first_name: str
    last_name: str
    role: Role
    active: bool
    building_ids: list[str]
    created_at: datetime


class UserLookup(InputModel):
    ids: list[UUID] = Field(max_length=1000)


class LoginResult(BaseModel):
    token: str
    user: UserView
    expires_at: datetime | None
    access_token: str
    access_expires_at: datetime


class Actor(BaseModel):
    user_id: UUID
    session_id: UUID
    role: Role
    building_ids: list[str]
    first_name: str
    last_name: str


class PasswordChange(InputModel):
    current_password: str = Field(min_length=1, max_length=1024)
    password: Password


class PasswordReset(InputModel):
    password: Password
