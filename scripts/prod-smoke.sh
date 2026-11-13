#!/bin/sh
# Local proof of the production images; never points at the real production project.
set -eu
export POSTGRES_PASSWORD=proof-only-postgres
export USERS_DB_PASSWORD=proof-only-users
export BOOKING_DB_PASSWORD=proof-only-booking
export ASSISTANT_DB_PASSWORD=proof-only-assistant
export INTERNAL_API_KEY=proof-only-internal-key-at-least-24-characters
export WEB_JWT_SECRET=proof-only-web-signing-key-at-least-32-characters
export MCP_ENCRYPTION_KEY=proof-only-mcp-encryption-key-at-least-32-characters
export PUBLIC_BASE_URL=http://localhost:8080
export ALLOWED_ORIGINS='["http://localhost:8080"]'
export BOOTSTRAP_ADMIN_LOGIN=proof-admin
export BOOTSTRAP_ADMIN_PASSWORD=proof-admin-password
export HTTP_BIND=127.0.0.1
export HTTP_PORT=0
export IMAGE_TAG=prod-proof
export OPENROUTER_API_KEY=
export OPENROUTER_MODEL=
PROOF_CLIENT=workplace-booking-prod-proof-client

compose() {
  docker compose --env-file /dev/null -p workplace-booking-prod-proof -f compose.prod.yaml "$@"
}
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    compose ps --all
    compose logs --tail 50 gateway users booking assistant nginx
  fi
  docker rm --force "$PROOF_CLIENT" >/dev/null 2>&1 || true
  compose down --volumes --remove-orphans
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

compose down --volumes --remove-orphans
compose build gateway users booking assistant nginx
docker build -f infra/frontend.Dockerfile --target dev -t workplace-booking-frontend-parser-proof .
compose up --no-build --pull never -d --wait --wait-timeout 180
proof_ingress=$(compose port nginx 8080)
test -n "$proof_ingress"
docker run --rm --network host workplace-gateway:prod-proof python -c '
import sys
import httpx
with httpx.Client(timeout=10, trust_env=False) as client:
    base = "http://" + sys.argv[1]
    assert client.get(base + "/health").status_code == 200
    page = client.get(base + "/booking")
    assert page.status_code == 200 and "<html" in page.text.lower()
print("OK host ingress: published Nginx port reaches the frontend from outside its network")
' "$proof_ingress"
compose run --rm --no-deps bootstrap
compose run --rm --no-deps bootstrap
# The OAuth SDK permits plain HTTP only for loopback. Share Nginx's namespace
# so the canonical localhost origin reaches the real ingress without weakening that guard.
docker run --rm --detach --name "$PROOF_CLIENT" \
  --network "container:$(compose ps --quiet nginx)" --read-only --tmpfs /tmp \
  workplace-gateway:prod-proof sleep infinity
docker exec --interactive "$PROOF_CLIENT" python - <<'PY'
import importlib.util
import json
import os
from pathlib import Path

import httpx

assert os.getuid() == 10001
assert importlib.util.find_spec('pytest') is None
assert importlib.util.find_spec('ruff') is None
assert importlib.util.find_spec('workplace_assistant') is None
print('OK production image: nonroot, no dev tools, no sibling service dependencies')

with httpx.Client(timeout=20) as client:
    for service in ('users', 'booking', 'assistant', 'gateway'):
        response = client.get(f'http://{service}:8000/health/ready')
        response.raise_for_status()
        assert response.json()['status'] == 'ok'
    print('OK production: all four APIs ready with PostgreSQL + JetStream')

    for path in ('/', '/booking', '/admin/users', '/health'):
        assert client.get('http://localhost:8080' + path).status_code == 200
    assert client.get('http://localhost:8080/api/buildings').status_code == 401
    assert client.get('http://localhost:8080/api/docs').status_code == 200
    assert client.get('http://localhost:8080/api/openapi.json').status_code == 200
    assert client.get('http://localhost:8080/internal/users').status_code == 404
    print('OK nginx: static frontend, SPA routes and API proxy')

    login = client.post('http://localhost:8080/api/auth/login', json={
        'login': 'proof-admin', 'password': 'proof-admin-password',
    })
    login.raise_for_status()
    assert login.json()['user']['role'] == 'admin'
    assert login.json()['expiresAt'] is None
    assert 'token' not in login.json()
    assert 'HttpOnly' in login.headers['set-cookie']
    assert 'Secure' in login.headers['set-cookie']
    print('OK public login: persisted bootstrap account and secure HttpOnly cookie')

    # Exercise the authenticated server path using the cookie header explicitly.
    # This is a local container HTTP proof; it does not assert external TLS/browser integration.
    cookie = '; '.join(value.split(';', 1)[0] for value in login.headers.get_list('set-cookie'))
    headers = {'Cookie': cookie, 'Origin': 'http://localhost:8080'}
    assert client.get('http://localhost:8080/api/auth/me', headers=headers).json()['firstName']
    catalog = client.get('http://localhost:8080/api/offices', headers=headers)
    assert catalog.status_code == 200 and catalog.json() == []
    policy = client.get('http://localhost:8080/api/booking/policy', headers=headers)
    assert policy.status_code == 200 and policy.json()['stepMinutes'] == 5
    office_response = client.post('http://localhost:8080/api/offices', headers=headers,
                                 json={'name': 'Проверочный офис', 'address': 'Этаж 1'})
    office_response.raise_for_status()
    office = office_response.json()
    office_id = office['id']
    floor = office['floors'][0]
    floor['elements'] = [{
        'id': 'room-proof', 'kind': 'room', 'type': 'meeting-room', 'name': 'Комната',
        'x': 10, 'y': 20, 'width': 300, 'height': 200, 'rotation': 0,
        'color': '#abcdef', 'locked': False, 'bookable': True, 'shared': True,
        'resourceType': 'meeting_room', 'equipment': [{'type': 'chair', 'quantity': 4}],
        'points': [{'x': 0, 'y': 0}, {'x': 300, 'y': 0}, {'x': 300, 'y': 200}],
        'vendor_data': {'snake_key': None},
    }]
    floor['background'] = {
        'src': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
        'name': 'План.png', 'opacity': 0.5, 'visible': True, 'locked': True,
        'x': -10, 'y': 10, 'width': 1000, 'height': 800,
    }
    assert office['revision'] == 1
    saved = client.put(f'http://localhost:8080/api/offices/{office_id}/plan',
                       headers={**headers, 'If-Match': f'"{office["revision"]}"'},
                       json={'floors': [floor]})
    saved.raise_for_status()
    assert saved.json()['floors'] == [floor]
    assert saved.json()['revision'] == 2
    settings = client.patch(f'http://localhost:8080/api/offices/{office_id}/settings',
                            headers={**headers, 'If-Match': f'"{saved.json()["revision"]}"'},
                            json={'name': 'Новое имя', 'hours': {'sun': {
                                'enabled': False, 'start': '10:00', 'end': '18:00'}}})
    settings.raise_for_status()
    actual = client.get(f'http://localhost:8080/api/offices/{office_id}', headers=headers).json()
    assert actual['floors'] == [floor] and actual['name'] == 'Новое имя'
    assert actual['revision'] == 3
    assert actual['hours'] == {'sun': {'enabled': False, 'start': '10:00', 'end': '18:00'}}
    assert 'address' not in actual
    Path('/tmp/bff-office.json').write_text(json.dumps(actual, ensure_ascii=False))
    bootstrap = client.get('http://localhost:8080/api/bootstrap', headers=headers)
    bootstrap.raise_for_status()
    assert len(bootstrap.json()['offices']) == 1
    print('OK BFF: real office creation, exact plan roundtrip, independent settings, bootstrap')
    employee = client.post('http://localhost:8080/api/users', headers=headers, json={
        'login': 'proof-employee', 'firstName': 'Анна', 'lastName': 'Сидорова',
        'role': 'employee', 'buildingIds': [office_id], 'password': 'proof-employee-password',
    })
    employee.raise_for_status()
    assert employee.json()['firstName'] == 'Анна' and 'first_name' not in employee.json()
    employee_login = client.post('http://localhost:8080/api/auth/login', json={
        'login': 'proof-employee', 'password': 'proof-employee-password',
    })
    employee_login.raise_for_status()
    employee_headers = {'Cookie': '; '.join(value.split(';', 1)[0] for value in
                        employee_login.headers.get_list('set-cookie')), 'Origin': 'http://localhost:8080'}
    assert len(client.get('http://localhost:8080/api/offices', headers=employee_headers).json()) == 1
    assert client.get('http://localhost:8080/api/users', headers=employee_headers).status_code == 403
    assert client.get('http://localhost:8080/api/offices/hidden-office', headers=employee_headers).status_code == 404
    print('OK Gateway: camelCase users, employee visibility and administrative permissions')
    assert client.post('http://localhost:8080/api/auth/refresh', headers=headers).status_code == 200
    chat = client.post('http://localhost:8080/api/chats/new', headers=headers)
    assert chat.status_code == 201
    assert client.get('http://localhost:8080/api/chats/current', headers=headers).json()['session']['id'] == chat.json()['session']['id']
    capabilities = client.get('http://localhost:8080/api/assistant/capabilities', headers=headers)
    capabilities.raise_for_status()
    assert capabilities.json()['generationAvailable'] is False
    chat_id = chat.json()['session']['id']
    sent = client.post(f'http://localhost:8080/api/chats/{chat_id}/messages',
                       headers={**headers, 'Idempotency-Key': 'unconfigured-production-proof'},
                       json={'message': 'Нужна переговорная', 'context': {'officeId': office_id}})
    assert sent.status_code == 503 and sent.json()['code'] == 'assistant_unconfigured'
    print('OK unconfigured Assistant: capabilities false, send503, no fabricated or paid response')
    assert client.post('http://localhost:8080/api/auth/logout', headers=headers).status_code == 204
    assert client.post('http://localhost:8080/api/auth/refresh', headers=headers).status_code == 401
    assert client.get('http://localhost:8080/api/auth/me').status_code == 401
    print('OK production: login/refresh/chat/logout, refresh session revoked; old access JWT expires in120s')
PY
docker exec --interactive "$PROOF_CLIENT" python - < scripts/prod-proof-oauth.py
docker exec "$PROOF_CLIENT" cat /tmp/bff-office.json | \
  docker run --rm --interactive --network none --read-only --tmpfs /tmp \
    --mount "type=bind,src=$PWD/apps/frontend/src,dst=/workspace/apps/frontend/src,readonly" \
    workplace-booking-frontend-parser-proof node --input-type=module -e '
import { parseConfig } from "/workspace/apps/frontend/src/office/lib/officeModel.ts";
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const office = parseConfig(raw);
if (office.floors[0].elements[0].vendor_data.snake_key !== null) throw new Error("Extension lost");
console.log("OK actual frontend parseConfig accepted the API office without conversion");
'
