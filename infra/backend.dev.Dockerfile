FROM ghcr.io/astral-sh/uv:0.13.7 AS uv
FROM python:3.12-slim-bookworm AS dev
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
RUN uv sync --locked --all-packages --group dev --no-cache
COPY scripts ./scripts
CMD ["sleep", "infinity"]
