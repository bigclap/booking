from uuid import uuid4

import pytest
from pydantic import ValidationError
from workplace_users import bootstrap
from workplace_users.bootstrap import BootstrapAdminInput
from workplace_users.schemas import UserCreate

SHORT_PASSWORD = "sevenpw"
# Test-only fixture.
KEY = "test-internal-key-at-least-24-characters"  # gitleaks:allow


def admin_input(password):
    return {
        "login": "  BOOT.Admin  ",
        "first_name": "  First  ",
        "last_name": "  Last  ",
        "role": "admin",
        "password": password,
    }


def test_short_bootstrap_password_retains_shared_account_validation():
    assert len(SHORT_PASSWORD) == 7
    value = BootstrapAdminInput(**admin_input(SHORT_PASSWORD))
    assert value.login == "boot.admin"
    assert value.first_name == "First" and value.last_name == "Last"
    assert SHORT_PASSWORD not in repr(value)
    with pytest.raises(ValidationError):
        UserCreate(**admin_input(SHORT_PASSWORD))
    with pytest.raises(ValidationError):
        BootstrapAdminInput(**{**admin_input(SHORT_PASSWORD), "email": "unsupported"})


@pytest.mark.parametrize("password", ["", "bootstrap-secret-marker" * 60])
def test_bootstrap_password_limits_do_not_echo_secret_in_validation_error(password):
    with pytest.raises(ValidationError) as failure:
        BootstrapAdminInput(**admin_input(password))
    error = str(failure.value)
    assert "input_value=" not in error
    assert "bootstrap-secret-marker" not in error


@pytest.mark.integration
async def test_short_password_bootstrap_logs_in_and_second_run_never_resets_it(
    api, monkeypatch, capsys
):
    client, sessions = api
    login = f"seed-{uuid4().hex}"
    monkeypatch.setenv("BOOTSTRAP_ADMIN_LOGIN", f"  {login.upper()}  ")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", SHORT_PASSWORD)
    monkeypatch.setenv("BOOTSTRAP_ADMIN_FIRST_NAME", "First")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_LAST_NAME", "Last")
    # Reuse this fixture's random test schema; bootstrap never touches the dev database.
    monkeypatch.setattr(bootstrap, "create_async_engine", lambda _url: sessions.kw["bind"])
    await bootstrap.run()
    first = await client.post(
        "/internal/auth/login",
        headers={"X-Internal-Key": KEY},
        json={"login": login, "password": SHORT_PASSWORD},
    )
    assert first.status_code == 200, first.text
    assert first.json()["user"]["role"] == "admin"
    user_id = first.json()["user"]["id"]
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", "replacement-secret")
    await bootstrap.run()
    retained = await client.post(
        "/internal/auth/login",
        headers={"X-Internal-Key": KEY},
        json={"login": login, "password": SHORT_PASSWORD},
    )
    assert retained.status_code == 200
    assert retained.json()["user"]["id"] == user_id
    replaced = await client.post(
        "/internal/auth/login",
        headers={"X-Internal-Key": KEY},
        json={"login": login, "password": "replacement-secret"},
    )
    assert replaced.status_code == 401
    output = capsys.readouterr().out
    assert "Initial administrator created" in output
    assert "Account already exists; no changes made" in output
    assert SHORT_PASSWORD not in output and "replacement-secret" not in output
