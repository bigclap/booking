#!/bin/sh
# Reproduce the assignment's mutation proof in disposable Docker containers only.
set -eu

cd "$(dirname "$0")/.."
proof_project=${BOOKING_PROOF_PROJECT:-workplace-booking-guard-proof-$$}
test_case=apps/booking/tests/test_bookings_http_integration.py::test_100_concurrent_real_http_requests_have_exactly_one_winner

compose() {
  docker compose -p "$proof_project" -f compose.test.yaml "$@"
}

cleanup() {
  compose down --volumes --remove-orphans
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! docker image inspect workplace-booking-dev >/dev/null 2>&1; then
  compose build tests
fi
compose up -d --wait postgres nats

printf 'Checking the intact guard against 100 concurrent HTTP requests per case.\n'
compose run --rm --no-deps tests pytest -q "$test_case"

printf 'Disabling only the conflict check inside one disposable Python process.\n'
set +e
compose run --rm -T --no-deps tests python - <<'PY'
import sys

import pytest
import workplace_booking.bookings as domain


async def disabled_conflict_check(*args, **kwargs):
    pass


class MutationObserver:
    failures = []

    def pytest_runtest_logreport(self, report):
        if report.when == "call" and report.failed:
            self.failures.append(report.longreprtext)


domain.check_conflicts = disabled_conflict_check
observer = MutationObserver()
result = pytest.main([
    "-q", "--tb=short", "-p", "no:anyio",
    "apps/booking/tests/test_bookings_http_integration.py::"
    "test_100_concurrent_real_http_requests_have_exactly_one_winner[False]",
], plugins=[observer])
if int(result) != 1 or len(observer.failures) != 1 or "assert 100 == 1" not in observer.failures[0]:
    print("Mutation proof failed: expected exactly 100 winners instead of one.")
    sys.exit(2)
print("Expected mutation detected: 100 successful creations instead of one.")
sys.exit(1)
PY
mutation_status=$?
set -e
if [ "$mutation_status" -ne 1 ]; then
  printf 'Unexpected mutation result: exit code %s.\n' "$mutation_status" >&2
  exit 1
fi

printf 'Rechecking the intact source guard in a fresh Python process.\n'
compose run --rm --no-deps tests pytest -q "$test_case"
printf 'Proof passed: intact guard passes, disabled guard fails, intact guard passes again.\n'
