"""Per-request correlation without storing credentials or mutable actor state."""

from contextvars import ContextVar

request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
trace_id: ContextVar[str | None] = ContextVar("trace_id", default=None)


def event_metadata() -> dict[str, str]:
    return {
        name: value
        for name, value in (("request_id", request_id.get()), ("trace_id", trace_id.get()))
        if value is not None
    }
