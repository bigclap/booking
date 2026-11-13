from copy import deepcopy

import pytest
from fastapi import HTTPException
from workplace_booking.offices import validate_plan


@pytest.mark.parametrize(
    "changes",
    [
        {"width": -1},
        {"height": float("inf")},
        {"x": float("nan")},
        {"bookable": "false"},
        {"shared": 1},
        {"seats": True},
        {"equipment": [{"type": "chair", "quantity": -1}]},
        {"equipment": [{"type": "chair", "quantity": 1.5}]},
        {"points": [{"x": "0", "y": 1}]},
        {"resourceType": "building"},
    ],
)
def test_invalid_geometry_or_resource_metadata_is_rejected(changes):
    floor = {
        "id": "floor",
        "name": "Этаж",
        "width": 1800,
        "height": 1100,
        "elements": [{"id": "desk", "name": "Стол", "kind": "desk", **changes}],
    }
    original = deepcopy(floor)
    with pytest.raises(HTTPException) as error:
        validate_plan("office", [floor])
    assert error.value.status_code == 422
    # Validation must not normalize the caller's extension-rich document in-place.
    assert floor.keys() == original.keys()
