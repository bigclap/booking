"""Safe, explicit import of a legacy constructor office, without users or bookings."""

import hashlib
import json
from copy import deepcopy
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from workplace_platform.auth import require_internal_key
from workplace_platform.typing import JsonObject, SessionDependency

from workplace_booking.models import Building, OfficeImportReceipt
from workplace_booking.offices import (
    _identifier,
    check_revision,
    get_building,
    id_conflict,
    invalid_document,
    lock_office_identifiers,
    office_document,
    record_change,
    replace_hours,
    replace_plan_documents,
    validate_plan,
)
from workplace_booking.schemas import OfficeDocument, OfficeImportInput, OfficeSettingsInput


def import_conflict() -> HTTPException:
    return HTTPException(409, detail={"code": "office_import_conflict"})


def import_parts(
    body: OfficeImportInput,
) -> tuple[str, list[JsonObject], set[str], OfficeSettingsInput, str]:
    """Gateway validates geometry; Booking also protects local identity/schedule invariants."""
    document = deepcopy(body.document)
    if type(document.get("version")) is not int or document["version"] != 1:
        raise invalid_document()
    office_id = _identifier(document.get("id"))
    raw_floors = document.get("floors")
    if not isinstance(raw_floors, list) or not 1 <= len(raw_floors) <= 40:
        raise invalid_document()
    floors: list[JsonObject] = []
    for floor in raw_floors:
        if not isinstance(floor, dict):
            raise invalid_document()
        floors.append(floor)
    identifiers = validate_plan(office_id, floors)
    try:
        settings = OfficeSettingsInput.model_validate(
            {
                "name": document.get("name"),
                "address": document.get("address"),
                "hours_document": document.get("hours"),
                "expected_revision": 1,
            }
        )
        updated_at = document.get("updatedAt")
        if not isinstance(updated_at, str):
            raise ValueError("Missing update date")
        datetime.fromisoformat(updated_at)
        encoded = json.dumps(
            body.model_dump(exclude_none=True),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
    except (ValidationError, TypeError, ValueError) as exc:
        raise invalid_document() from exc
    return office_id, floors, identifiers, settings, hashlib.sha256(encoded).hexdigest()


def same_document(
    existing: OfficeDocument,
    settings: OfficeSettingsInput,
    floors: list[JsonObject],
) -> bool:
    return (
        existing.name == settings.name
        and existing.address == settings.address
        and existing.hours_document
        == {day: entry.model_dump() for day, entry in settings.hours_document.items()}
        and [floor.plan_document for floor in existing.floors] == floors
    )


async def import_office(
    session: AsyncSession,
    body: OfficeImportInput,
    actor_id: str,
    key: str,
) -> OfficeDocument:
    office_id, floors, identifiers, settings, fingerprint = import_parts(body)
    async with session.begin():
        await lock_office_identifiers(session)
        receipt = await session.get(OfficeImportReceipt, (actor_id, key))
        if receipt is not None:
            if receipt.fingerprint != fingerprint:
                raise HTTPException(409, detail={"code": "idempotency_key_conflict"})
            building = await get_building(session, receipt.office_id, lock=True)
            return await office_document(session, building)

        # Include deleted identities: importing is never a restore or an overwrite operation.
        existing = await session.scalar(
            select(Building).where(Building.id == office_id).with_for_update()
        )
        if existing is not None:
            if existing.deleted_at is not None:
                raise import_conflict()
            if body.expected_revision is not None:
                check_revision(existing, body.expected_revision)
            result = await office_document(session, existing)
            if not same_document(result, settings, floors):
                raise import_conflict()
        else:
            existing = Building(
                id=office_id,
                name=settings.name,
                address=settings.address,
                revision=1,
            )
            session.add(existing)
            await session.flush()
            await replace_hours(
                session,
                existing,
                {
                    day: {"enabled": entry.enabled, "start": entry.start, "end": entry.end}
                    for day, entry in settings.hours_document.items()
                },
            )
            await replace_plan_documents(session, office_id, floors, identifiers)
            await record_change(session, existing, "imported", advance_revision=False)
            result = await office_document(session, existing)

        session.add(
            OfficeImportReceipt(
                actor_id=actor_id,
                key=key,
                fingerprint=fingerprint,
                office_id=office_id,
            )
        )
    return result


def create_router(get_session: SessionDependency) -> APIRouter:
    router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal_key)])

    @router.post("/offices/import", response_model=OfficeDocument, tags=["offices"])
    async def import_document(
        body: OfficeImportInput,
        session: Annotated[AsyncSession, Depends(get_session)],
        actor_id: Annotated[str, Header(alias="X-User-ID", min_length=1, max_length=160)],
        key: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)],
    ) -> OfficeDocument:
        try:
            return await import_office(session, body, actor_id, key)
        except IntegrityError as exc:
            raise id_conflict() from exc

    return router
