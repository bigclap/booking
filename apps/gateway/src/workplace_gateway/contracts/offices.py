"""Public office documents follow the existing constructor's JSON shape.

Documents preserve extension keys. API commands remain closed schemas, and neither
case applies a recursive key conversion to arbitrary plan data or dictionary keys.
"""

from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    SerializationInfo,
    SerializerFunctionWrapHandler,
    StrictBool,
    StrictInt,
    StrictStr,
    field_validator,
    model_serializer,
    model_validator,
)

Identifier = Annotated[StrictStr, Field(min_length=1, max_length=1000)]
Text = Annotated[StrictStr, Field(max_length=1000)]
Coordinate = Annotated[float, Field(strict=True, allow_inf_nan=False, ge=-100000, le=100000)]
Dimension = Annotated[float, Field(strict=True, allow_inf_nan=False, ge=1, le=20000)]
Weekday = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
ClockTime = Annotated[StrictStr, Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")]


class _WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=False)

    @model_validator(mode="before")
    @classmethod
    def reject_reserved_snake_case(cls, value: object) -> object:
        if isinstance(value, dict):
            for name, field in cls.model_fields.items():
                if field.alias and name != field.alias and name in value:
                    raise ValueError(f"Use the public field {field.alias!r}, not {name!r}")
        return value


class _DocumentModel(_WireModel):
    model_config = ConfigDict(extra="allow", validate_by_alias=True, validate_by_name=False)

    @model_serializer(mode="wrap")
    def serialize_extensions(self, handler: SerializerFunctionWrapHandler, info: SerializationInfo):
        # type: (...) -> dict[str, object]
        # A runtime return annotation would replace the model's public JSON schema
        # with a generic mapping. The type comment keeps this wrap transparent.
        # Pydantic's model serializer produces this model's field mapping.
        result: dict[str, object] = handler(self)
        # Known missing optional fields may be omitted, but an extension's explicit
        # null is part of the opaque document and must survive a save/load cycle.
        if info.exclude_none and self.model_extra:
            for key, value in self.model_extra.items():
                if value is not None:
                    continue
                if info.exclude and key in info.exclude:
                    continue
                if info.include is not None and key not in info.include:
                    continue
                result[key] = None
        return result


def _nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("Must not be blank")
    return value


class PointDocument(_DocumentModel):
    x: Coordinate
    y: Coordinate


class EquipmentItem(_DocumentModel):
    type: Annotated[StrictStr, Field(min_length=1, max_length=1000)]
    quantity: Annotated[int, Field(ge=0, le=100000)]

    _type_nonblank = field_validator("type")(_nonblank)

    @field_validator("quantity", mode="before")
    @classmethod
    def integer_quantity(cls, value: object) -> int:
        return _integer_count(value)


def _integer_count(value: object) -> int:
    # JS Number.isInteger accepts 2.0 but rejects strings and booleans.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Must be an integer number")
    if isinstance(value, float) and (not value.is_integer()):
        raise ValueError("Must be an integer number")
    return int(value)


class PlanElementDocument(_DocumentModel):
    id: Identifier
    kind: Literal["wall", "room", "desk", "furniture"]
    type: Annotated[StrictStr, Field(min_length=1, max_length=1000)]
    name: Text
    x: Coordinate
    y: Coordinate
    width: Dimension
    height: Dimension
    rotation: Annotated[float, Field(strict=True, allow_inf_nan=False, ge=-360000, le=360000)]
    color: Text
    locked: StrictBool
    resource_type: Literal["meeting_room", "workplace"] | None = Field(
        default=None, alias="resourceType"
    )
    room_id: Identifier | None = Field(default=None, alias="roomId")
    seats: Annotated[int, Field(ge=0, le=100000)] | None = None
    bookable: StrictBool | None = None
    shared: StrictBool | None = None
    walls: StrictBool | None = None
    equipment: Annotated[list[EquipmentItem], Field(max_length=1000)] | None = None
    points: Annotated[list[PointDocument], Field(max_length=1000)] | None = None

    _required_nonblank = field_validator("id", "type")(_nonblank)

    @field_validator(
        "resource_type",
        "room_id",
        "seats",
        "bookable",
        "shared",
        "walls",
        "equipment",
        "points",
        mode="before",
    )
    @classmethod
    def optional_fields_are_not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Omit an absent optional field instead of sending null")
        return value

    @field_validator("room_id")
    @classmethod
    def parent_nonblank(cls, value: str | None) -> str | None:
        return _nonblank(value) if value is not None else value

    @field_validator("seats", mode="before")
    @classmethod
    def integer_seats(cls, value: object) -> int | None:
        if value is None:
            return value
        return _integer_count(value)


class BackgroundDocument(_DocumentModel):
    src: Annotated[
        StrictStr,
        Field(pattern=r"^data:image/(png|jpeg|jpg|webp|gif|avif);base64,[a-zA-Z0-9+/=\s]+$"),
    ]
    name: Text
    opacity: Annotated[float, Field(strict=True, allow_inf_nan=False, ge=0, le=1)]
    visible: StrictBool
    locked: StrictBool
    x: Coordinate | None = None
    y: Coordinate | None = None
    width: Dimension | None = None
    height: Dimension | None = None

    @field_validator("x", "y", "width", "height", mode="before")
    @classmethod
    def optional_geometry_is_not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Omit absent geometry instead of sending null")
        return value


class FloorDocument(_DocumentModel):
    id: Identifier
    name: Text
    width: Dimension
    height: Dimension
    elements: Annotated[list[PlanElementDocument], Field(max_length=10000)]
    background: BackgroundDocument | None = None

    _id_nonblank = field_validator("id")(_nonblank)

    @field_validator("background", mode="before")
    @classmethod
    def optional_background_is_not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Omit an absent background instead of sending null")
        return value

    @model_validator(mode="after")
    def validate_parents(self) -> Self:
        by_id = {element.id: element for element in self.elements}
        if len(by_id) != len(self.elements):
            raise ValueError("Element identifiers must be unique")
        for element in self.elements:
            if element.room_id is None:
                continue
            parent = by_id.get(element.room_id)
            if parent is None or parent.kind != "room" or parent.id == element.id:
                raise ValueError(f"Object {element.id!r} must reference a room in the same floor")
        resolved: set[str] = set()
        for element in self.elements:
            current = element
            path: set[str] = set()
            while current.id not in resolved:
                if current.id in path:
                    raise ValueError("Room references must not contain a cycle")
                path.add(current.id)
                if current.room_id is None:
                    break
                current = by_id[current.room_id]
            resolved.update(path)
        return self


def validate_floor_graph(floors: list[FloorDocument], office_id: str | None = None) -> None:
    seen = {office_id} if office_id is not None else set()
    for floor in floors:
        for identifier in [floor.id, *(element.id for element in floor.elements)]:
            if identifier in seen:
                raise ValueError(f"Duplicate office identifier: {identifier!r}")
            seen.add(identifier)


class WorkingDay(_WireModel):
    enabled: StrictBool
    start: ClockTime
    end: ClockTime

    @model_validator(mode="after")
    def ordered_working_interval(self) -> Self:
        if self.enabled and self.start >= self.end:
            raise ValueError("The working interval must end after it starts, within one date")
        return self


OfficeHours = dict[Weekday, WorkingDay]


class OfficeDocument(_DocumentModel):
    version: Literal[1]
    id: Identifier
    name: Text
    address: Annotated[StrictStr, Field(max_length=160)] | None = None
    updated_at: AwareDatetime = Field(alias="updatedAt")
    floors: Annotated[list[FloorDocument], Field(min_length=1, max_length=40)]
    hours: OfficeHours
    revision: Annotated[StrictInt, Field(ge=1)] | None = None

    _id_nonblank = field_validator("id")(_nonblank)

    @field_validator("updated_at", mode="before")
    @classmethod
    def timestamp_is_text_or_internal_datetime(cls, value: object) -> str | datetime:
        if not isinstance(value, (str, datetime)):
            raise ValueError("updatedAt must be an ISO timestamp")
        return value

    @field_validator("version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> object:
        if isinstance(value, bool) or value != 1:
            raise ValueError("Unsupported office document version")
        return value

    @model_validator(mode="after")
    def unique_identifiers(self) -> Self:
        validate_floor_graph(self.floors, self.id)
        return self


class OfficeCreate(_WireModel):
    name: Annotated[StrictStr, Field(min_length=1, max_length=80)]
    address: Annotated[StrictStr, Field(max_length=160)] | None = None

    @field_validator("name", "address", mode="before")
    @classmethod
    def trim_text(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("Must be text")
        return value.strip()


class OfficeSettingsUpdate(OfficeCreate):
    hours: OfficeHours
    revision: Annotated[StrictInt, Field(ge=1)] | None = None


class OfficePlanUpdate(_WireModel):
    floors: Annotated[list[FloorDocument], Field(min_length=1, max_length=40)]
    revision: Annotated[StrictInt, Field(ge=1)] | None = None

    @model_validator(mode="after")
    def unique_identifiers(self) -> Self:
        validate_floor_graph(self.floors)
        return self

    def validate_for_office(self, office_id: str) -> Self:
        validate_floor_graph(self.floors, office_id)
        return self


class OfficeImport(_WireModel):
    document: OfficeDocument
    revision: Annotated[StrictInt, Field(ge=1)] | None = None
