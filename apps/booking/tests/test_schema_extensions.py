"""Typing known fields must not discard constructor or historical JSON extensions."""

from pydantic import TypeAdapter
from workplace_booking.schemas import ResourceView
from workplace_booking.types import ResourceSnapshot


def test_resource_equipment_extensions_survive_public_serialization():
    equipment = [{"type": "chair", "quantity": 1, "variant": "ergonomic"}]
    resource = ResourceView.model_validate(
        {
            "id": "desk",
            "floor_id": "floor",
            "parent_room_id": None,
            "kind": "workstation",
            "name": "Место",
            "shared_booking": False,
            "equipment": equipment,
        }
    )
    assert resource.model_dump(mode="json")["equipment"] == equipment


def test_historical_snapshot_and_nested_equipment_extensions_survive_serialization():
    snapshot = {
        "id": "desk",
        "kind": "workstation",
        "equipment": [{"type": "chair", "quantity": 1, "variant": "ergonomic"}],
        "custom_label": {"version": 1, "values": ["original", None]},
    }
    adapter = TypeAdapter(ResourceSnapshot)
    assert adapter.dump_python(adapter.validate_python(snapshot), mode="json") == snapshot
