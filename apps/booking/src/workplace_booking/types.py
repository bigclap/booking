"""Booking-owned data contracts; constructor extensions remain recursive JSON."""

from datetime import date as Date
from datetime import datetime
from typing import Literal, TypedDict

from pydantic import ConfigDict, with_config
from workplace_platform.typing import JsonObject

ResourceKind = Literal["workstation", "meeting_room"]
BookingStatus = Literal["active", "cancelled"]


@with_config(ConfigDict(extra="allow"))
class EquipmentItem(TypedDict):
    type: str
    quantity: int


class DayHoursData(TypedDict):
    enabled: bool
    start: str
    end: str


type HoursDocument = dict[str, DayHoursData]


@with_config(ConfigDict(extra="allow"))
class ResourceSnapshot(TypedDict, total=False):
    """Legacy records may have an empty snapshot before their first mutation."""

    id: str
    name: str
    kind: ResourceKind
    floor_id: str
    floor_name: str
    capacity: int
    equipment: list[EquipmentItem]
    descendant_ids: list[str]


class CapacityWarning(TypedDict):
    code: Literal["capacity_exceeded"]
    capacity: int
    participants: int


class ProjectedResource(TypedDict):
    id: str
    floor_id: str
    name: str
    kind: ResourceKind
    shared_booking: bool
    parent_room_id: str | None


class BookingHistoryEntry(TypedDict):
    revision: int
    operation: str
    snapshot: JsonObject
    occurred_at: datetime


class AvailableResource(ResourceSnapshot):
    parent_room_id: str | None
    shared_booking: bool
    available: bool
    policy_error: str | None
    conflicting_booking_ids: list[str]
    cursor_status: Literal["free", "partial", "occupied"]
    bookable_places: int
    occupied_places: int


class AvailabilityView(TypedDict):
    office_id: str
    floor_id: str
    revision: int
    resources: list[AvailableResource]


class BookingCandidate(TypedDict):
    floor_id: str
    resource_id: str
    date: Date
    start: int | float
    end: int | float
    owner_id: str
    participants: int | None
