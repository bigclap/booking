from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel

MOSCOW = ZoneInfo("Europe/Moscow")


class BookingPolicy(BaseModel):
    timezone: str = "Europe/Moscow"
    step_minutes: int
    horizon_days: int
    server_now: datetime
    earliest_start: datetime
    allowed_dates: list[date]


def policy_snapshot(
    step_minutes: int, horizon_days: int, now: datetime | None = None
) -> BookingPolicy:
    """Calendar horizon includes today; ceil start to the local day's time grid."""
    if step_minutes < 1 or horizon_days < 1:
        raise ValueError("Booking step and horizon must be positive")
    current = now if now is not None else datetime.now(UTC)
    if current.tzinfo is None or current.utcoffset() is None:
        raise ValueError("Current time must include a timezone")
    current = current.astimezone(MOSCOW)
    midnight = datetime.combine(current.date(), time.min, tzinfo=MOSCOW)
    step = timedelta(minutes=step_minutes)
    slots, remainder = divmod(current - midnight, step)
    earliest = midnight + step * (slots + bool(remainder))
    return BookingPolicy(
        step_minutes=step_minutes,
        horizon_days=horizon_days,
        server_now=current,
        earliest_start=earliest,
        allowed_dates=[current.date() + timedelta(days=offset) for offset in range(horizon_days)],
    )
