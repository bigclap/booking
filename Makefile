.PHONY: up down ps logs build lock lint test smoke bootstrap shell migrate frontend format format-check
COMPOSE_DEV = docker compose -f compose.dev.yaml
COMPOSE_PROD = docker compose --env-file .env.prod -f compose.prod.yaml

up:
	$(COMPOSE_DEV) up --build -d --wait

down:
	$(COMPOSE_DEV) down

ps:
	$(COMPOSE_DEV) ps

logs:
	$(COMPOSE_DEV) logs -f --tail=100

build:
	$(COMPOSE_DEV) build

frontend:
	$(COMPOSE_DEV) up --build -d nginx

format:
	$(COMPOSE_DEV) --profile tools run --build --rm --no-deps --user "$$(id -u):$$(id -g)" formatter --write .

format-check:
	$(COMPOSE_DEV) --profile tools run --build --rm --no-deps --user "$$(id -u):$$(id -g)" formatter --check .

# Only uv.lock is written to the working tree; dependencies and cache stay in Docker.
lock:
	docker run --rm --user "$$(id -u):$$(id -g)" -e UV_CACHE_DIR=/tmp/uv-cache -e PYTHONDONTWRITEBYTECODE=1 -v "$$(pwd):/workspace" -w /workspace ghcr.io/astral-sh/uv:0.13.7-python3.12-trixie-slim uv lock

lint:
	$(COMPOSE_DEV) run --rm --no-deps dev ruff check packages apps scripts
	$(COMPOSE_DEV) run --rm --no-deps dev ruff format --check packages apps scripts

test:
	sh scripts/test.sh pytest -q

smoke:
	$(COMPOSE_DEV) run --rm --no-deps dev python scripts/smoke.py

bootstrap:
	$(COMPOSE_DEV) run --rm --no-deps bootstrap

shell:
	$(COMPOSE_DEV) run --rm dev bash

migrate:
	$(COMPOSE_DEV) run --rm users-migrate
	$(COMPOSE_DEV) run --rm booking-migrate
	$(COMPOSE_DEV) run --rm assistant-migrate

.PHONY: prod-up prod-down prod-config prod-bootstrap prod-smoke
prod-up:
	$(COMPOSE_PROD) up --build -d --wait

prod-down:
	$(COMPOSE_PROD) down

prod-config:
	$(COMPOSE_PROD) config --quiet

prod-bootstrap:
	$(COMPOSE_PROD) run --rm --no-deps bootstrap

prod-smoke:
	sh scripts/prod-smoke.sh
