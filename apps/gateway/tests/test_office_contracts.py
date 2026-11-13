from copy import deepcopy

import pytest
from pydantic import ValidationError
from workplace_gateway.contracts.offices import (
    OfficeCreate,
    OfficeDocument,
    OfficePlanUpdate,
    OfficeSettingsUpdate,
)


def element(identifier="desk-1", kind="desk", **changes):
    return {
        "id": identifier,
        "kind": kind,
        "type": "desk",
        "name": "Стол",
        "x": 12.5,
        "y": 25,
        "width": 80,
        "height": 60,
        "rotation": 0,
        "color": "#e8d4b6",
        "locked": False,
        **changes,
    }


@pytest.fixture
def office():
    return {
        "version": 1,
        "id": "office-example",
        "name": "Офис",
        "updatedAt": "2026-11-12T12:30:00Z",
        "hours": {
            "mon": {"enabled": True, "start": "09:00", "end": "19:00"},
            "sun": {"enabled": False, "start": "09:00", "end": "19:00"},
        },
        "floors": [
            {
                "id": "floor-1",
                "name": "1 этаж",
                "width": 1800,
                "height": 1100,
                "elements": [
                    element("room-1", "room", resourceType="meeting_room", shared=True),
                    element(roomId="room-1", resourceType="workplace"),
                ],
                "background": {
                    "src": "data:image/png;base64,aGVsbG8=",
                    "name": "План",
                    "opacity": 0.45,
                    "visible": True,
                    "locked": True,
                    "x": -20,
                    "y": 15,
                    "width": 1000,
                    "height": 900,
                },
            }
        ],
    }


def test_constructor_document_round_trip_preserves_extensions_and_camel_case(office):
    office["vendorNull"] = None
    office["floors"][0]["anchors"] = {"desk_external_id": {"some_key": 4, "optional": None}}
    office["floors"][0]["elements"][1]["vendorNull"] = None
    document = OfficeDocument.model_validate(office)
    public = document.model_dump(mode="json", by_alias=True, exclude_none=True)
    assert public == office
    assert "roomId" in public["floors"][0]["elements"][1]
    assert "resource_type" not in public["floors"][0]["elements"][1]


def test_long_prefixed_identifiers_follow_frontend_parser_bound(office):
    office["floors"][0]["elements"][1]["id"] = "desk-" + "x" * 995
    assert OfficeDocument.model_validate(office).floors[0].elements[1].id.endswith("x")


@pytest.mark.parametrize("replacement", [float("nan"), float("inf"), "12", True])
def test_coordinates_reject_non_numbers_and_non_finite_values(office, replacement):
    office["floors"][0]["elements"][0]["x"] = replacement
    with pytest.raises(ValidationError):
        OfficeDocument.model_validate(office)


def test_identity_collision_includes_office_floors_and_elements(office):
    office["floors"][0]["elements"][1]["id"] = office["id"]
    with pytest.raises(ValidationError, match="Duplicate office identifier"):
        OfficeDocument.model_validate(office)


def test_identity_collision_between_floors_is_rejected(office):
    floor = deepcopy(office["floors"][0])
    floor["id"] = "floor-2"
    office["floors"].append(floor)
    with pytest.raises(ValidationError, match="Duplicate office identifier"):
        OfficeDocument.model_validate(office)


@pytest.mark.parametrize("target", ["absent-room", "desk-1"])
def test_parent_must_be_a_room_in_the_same_floor(office, target):
    office["floors"][0]["elements"][1]["roomId"] = target
    with pytest.raises(ValidationError, match="must reference a room"):
        OfficeDocument.model_validate(office)


def test_room_cycles_are_rejected(office):
    office["floors"][0]["elements"] = [
        element("room-a", "room", roomId="room-b"),
        element("room-b", "room", roomId="room-a"),
    ]
    with pytest.raises(ValidationError, match="must not contain a cycle"):
        OfficeDocument.model_validate(office)


def test_snake_case_alias_is_rejected_even_in_extensible_documents(office):
    office["floors"][0]["elements"][1]["room_id"] = "room-1"
    with pytest.raises(ValidationError, match="public field 'roomId'"):
        OfficeDocument.model_validate(office)


@pytest.mark.parametrize("src", ["https://example.com/plan.png", "data:image/svg+xml;base64,YQ=="])
def test_background_must_remain_an_embedded_raster_image(office, src):
    office["floors"][0]["background"]["src"] = src
    with pytest.raises(ValidationError):
        OfficeDocument.model_validate(office)


def test_enabled_hours_must_be_ordered_but_closed_days_keep_their_draft():
    value = {
        "name": "Офис",
        "hours": {
            "sun": {
                "enabled": False,
                "start": "19:00",
                "end": "09:00",
            }
        },
    }
    assert OfficeSettingsUpdate.model_validate(value).hours["sun"].start == "19:00"
    value["hours"]["sun"]["enabled"] = True
    with pytest.raises(ValidationError, match="must end after"):
        OfficeSettingsUpdate.model_validate(value)


def test_closed_day_still_requires_valid_clock_text():
    with pytest.raises(ValidationError):
        OfficeSettingsUpdate.model_validate(
            {
                "name": "Офис",
                "hours": {
                    "sun": {"enabled": False, "start": "25:00", "end": "09:00"},
                },
            }
        )


def test_commands_reject_documents_from_the_wrong_editor(office):
    with pytest.raises(ValidationError):
        OfficeSettingsUpdate.model_validate({"name": "Офис", "hours": {}, "floors": []})
    with pytest.raises(ValidationError):
        OfficePlanUpdate.model_validate({"floors": office["floors"], "name": "Новое имя"})


def test_creation_matches_existing_office_store_normalization():
    create = OfficeCreate.model_validate({"name": "  Новый офис  ", "address": "  Москва  "})
    assert create.model_dump() == {"name": "Новый офис", "address": "Москва"}
    with pytest.raises(ValidationError):
        OfficeCreate.model_validate({"name": " "})
    with pytest.raises(ValidationError):
        OfficeCreate.model_validate({"name": "Офис", "address": None})


def test_plan_can_be_checked_against_the_target_office_id(office):
    value = OfficePlanUpdate.model_validate({"floors": office["floors"]})
    with pytest.raises(ValueError, match="Duplicate office identifier"):
        value.validate_for_office("desk-1")


def test_boolean_is_not_an_office_document_version(office):
    office["version"] = True
    with pytest.raises(ValidationError, match="Unsupported office document version"):
        OfficeDocument.model_validate(office)


@pytest.mark.parametrize("field", ["roomId", "resourceType", "seats", "equipment", "points"])
def test_optional_element_fields_follow_frontend_undefined_not_null(office, field):
    office["floors"][0]["elements"][1][field] = None
    with pytest.raises(ValidationError, match="absent optional field"):
        OfficeDocument.model_validate(office)


def test_document_schema_documents_public_aliases():
    schema = OfficeDocument.model_json_schema(mode="serialization")
    assert "updatedAt" in schema["properties"]
    assert "updated_at" not in schema["properties"]
