FROM ghcr.io/astral-sh/uv:0.13.7 AS uv
FROM python:3.12-slim-bookworm AS base
COPY --from=uv /uv /uvx /usr/local/bin/
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_CACHE_DIR=/var/cache/uv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH" \
    RUFF_CACHE_DIR=/tmp/ruff-cache
WORKDIR /workspace
COPY pyproject.toml uv.lock ./
COPY packages ./packages
COPY apps/users ./apps/users
COPY apps/booking ./apps/booking
COPY apps/assistant ./apps/assistant
COPY apps/gateway ./apps/gateway

# A service may also be built without the other applications or developer tools installed.
FROM base AS production
ARG SERVICE_PACKAGE=workplace-gateway
ARG APP_MODULE=workplace_gateway.main:app
RUN uv sync --locked --package ${SERVICE_PACKAGE} --no-dev --no-editable --no-cache
RUN useradd --uid 10001 --create-home app
USER app
ENV APP_MODULE=${APP_MODULE}
CMD ["sh", "-c", "exec uvicorn ${APP_MODULE} --host 0.0.0.0 --port 8000 --no-access-log"]
