from datetime import UTC, date, datetime

import pytest
from workplace_booking.policy import policy_snapshot


def test_horizon_uses_moscow_calendar_dates_including_today():
    result = policy_snapshot(5, 7, datetime(2026, 11, 12, 21, 2, tzinfo=UTC))
    assert result.allowed_dates == [date(2026, 11, day) for day in range(13, 20)]
    assert result.earliest_start.isoformat() == "2026-11-13T00:05:00+03:00"


@pytest.mark.parametrize(
    ("minute", "second", "microsecond", "expected"),
    [
        (0, 0, 0, "10:00:00"),
        (0, 0, 1, "10:05:00"),
        (2, 0, 0, "10:05:00"),
        (5, 0, 0, "10:05:00"),
        (59, 59, 0, "11:00:00"),
    ],
)
def test_earliest_start_never_falls_before_now(minute, second, microsecond, expected):
    result = policy_snapshot(5, 7, datetime(2026, 11, 12, 7, minute, second, microsecond, UTC))
    assert result.earliest_start.strftime("%H:%M:%S") == expected
    assert result.earliest_start >= result.server_now


def test_ceil_carries_to_the_next_day():
    result = policy_snapshot(5, 1, datetime(2026, 11, 12, 20, 59, 59, tzinfo=UTC))
    assert result.allowed_dates == [date(2026, 11, 12)]
    assert result.earliest_start.isoformat() == "2026-11-13T00:00:00+03:00"


def test_configured_step_and_horizon_are_used():
    result = policy_snapshot(15, 2, datetime(2026, 11, 12, 7, 16, tzinfo=UTC))
    assert result.earliest_start.isoformat() == "2026-11-12T10:30:00+03:00"
    assert result.allowed_dates == [date(2026, 11, 12), date(2026, 11, 13)]


def test_naive_datetime_is_rejected_instead_of_assuming_the_host_timezone():
    with pytest.raises(ValueError, match="timezone"):
        policy_snapshot(5, 7, datetime(2026, 11, 12, 10))
