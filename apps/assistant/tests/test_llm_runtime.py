"""Real MCP HTTP transport + deterministic Pydantic AI model (no paid LLM calls)."""

import asyncio
import json
import socket
from contextlib import asynccontextmanager

import pytest
import uvicorn
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from workplace_assistant.config import AssistantSettings
from workplace_assistant.runtime import extract_prepared_proposal, run_agent, trim_history_chunks
from workplace_platform.correlation import request_id, trace_id

PROPOSAL = {
    "officeId": "office-a",
    "floorId": "floor-a",
    "resourceId": "room-a",
    "date": "2026-11-12",
    "start": 600,
    "end": 660,
    "participants": 3,
    "url": "/booking?officeId=office-a&resourceId=room-a&date=2026-11-12&start=600&end=660",
}


@asynccontextmanager
async def mcp_server(proposal=PROPOSAL, *, workstation=False, always_fail=False):
    mcp = MCPServer("Assistant runtime test")
    calls = []
    credentials = []

    @mcp.tool()
    def prepare_booking(officeId: str, participants: int | None = None) -> dict:
        calls.append(("prepare_booking", officeId))
        if always_fail or workstation and participants is not None:
            raise ToolError("Число участников указывается только для переговорной.")
        return {"proposal": proposal}

    @mcp.tool()
    def availability(officeId: str) -> dict:
        calls.append(("availability", officeId))
        return {"resources": []}

    @mcp.tool()
    def cancel_booking(bookingId: str) -> dict:
        raise AssertionError("The built-in assistant must never expose booking mutation")

    @mcp.tool()
    def admin_create_user(login: str) -> dict:
        raise AssertionError("No administrative tools may be exposed to the model")

    app = mcp.streamable_http_app(stateless_http=True, json_response=True)

    async def capture(scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope["headers"])
            credentials.append(
                (
                    headers.get(b"authorization"),
                    headers.get(b"x-request-id"),
                    headers.get(b"x-trace-id"),
                )
            )
        await app(scope, receive, send)

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    server = uvicorn.Server(uvicorn.Config(capture, log_level="critical", lifespan="on"))
    task = asyncio.create_task(server.serve(sockets=[listener]))
    try:
        async with asyncio.timeout(5):
            while not server.started:
                if task.done():
                    await task
                await asyncio.sleep(0.01)
        yield f"http://127.0.0.1:{listener.getsockname()[1]}/mcp", calls, credentials
    finally:
        server.should_exit = True
        await asyncio.wait_for(task, 5)
        listener.close()


def settings(url):
    return AssistantSettings(
        # Test-only fixture.
        internal_api_key="test-internal-key-at-least-24-characters",  # gitleaks:allow
        mcp_url=url,
        openrouter_api_key="test-provider-secret",
        openrouter_model="test/not-a-real-model",
    )


def tool_returned(messages, name):
    return any(
        isinstance(part, ToolReturnPart) and part.tool_name == name and part.outcome == "success"
        for message in messages
        for part in message.parts
    )


def answer(info, *, proposal=None):
    return ModelResponse(
        parts=[
            ToolCallPart(
                info.output_tools[0].name,
                {"message": "Проверьте параметры и подтвердите в форме.", "proposal": proposal},
            )
        ]
    )


async def test_real_mcp_transport_isolates_credentials_and_filters_mutating_tools():
    async with mcp_server() as (url, calls, credentials):

        def model(messages, info):
            names = {tool.name for tool in info.function_tools}
            assert names == {"prepare_booking", "availability"}
            if tool_returned(messages, "prepare_booking"):
                return answer(info, proposal=PROPOSAL)
            return ModelResponse(parts=[ToolCallPart("prepare_booking", {"officeId": "office-a"})])

        async def generate(actor):
            request_token = request_id.set(f"request-{actor}")
            trace_token = trace_id.set(f"trace-{actor}")
            try:
                return await run_agent(
                    settings(url),
                    "Нужна комната",
                    [],
                    {"officeId": "office-a"},
                    f"user-{actor}-secret",
                    model=FunctionModel(model),
                )
            finally:
                request_id.reset(request_token)
                trace_id.reset(trace_token)

        results = await asyncio.gather(generate("a"), generate("b"))
        assert len(calls) == 2
        assert {item for item in credentials} == {
            (b"Bearer user-a-secret", b"request-a", b"trace-a"),
            (b"Bearer user-b-secret", b"request-b", b"trace-b"),
        }
        for result in results:
            assert result.reply.proposal.resourceId == "room-a"
            assert result.reply.proposal.start == 600
            stored = json.dumps(result.run_messages)
            assert "user-a-secret" not in stored
            assert "user-b-secret" not in stored
            assert "test-provider-secret" not in stored
            assert "request-a" not in stored and "request-b" not in stored
            assert "trace-a" not in stored and "trace-b" not in stored
            assert "prepare_booking" in stored


async def test_fabricated_proposal_requires_actual_successful_prepare_result():
    async with mcp_server() as (url, calls, credentials):
        attempts = 0

        def model(messages, info):
            nonlocal attempts
            attempts += 1
            return answer(info, proposal=PROPOSAL if attempts == 1 else None)

        result = await run_agent(
            settings(url),
            "Нужна комната",
            [],
            {"officeId": "office-a"},
            "user-secret",
            model=FunctionModel(model),
        )
        assert attempts == 2
        assert result.reply.proposal is None
        assert calls == []


async def test_mcp_tool_loop_has_a_finite_request_budget():
    async with mcp_server() as (url, calls, credentials):

        def model(messages, info):
            return ModelResponse(parts=[ToolCallPart("availability", {"officeId": "office-a"})])

        configuration = settings(url)
        configuration.generation_request_limit = 2
        with pytest.raises(UsageLimitExceeded):
            await run_agent(
                configuration,
                "Нужна комната",
                [],
                {"officeId": "office-a"},
                "secret",
                model=FunctionModel(model),
            )
        assert len(calls) == 2


async def test_real_mcp_business_error_lets_model_correct_workstation_arguments():
    proposal = {key: value for key, value in PROPOSAL.items() if key != "participants"}
    proposal["resourceId"] = "desk-a"
    proposal["url"] = "/booking?officeId=office-a&resourceId=desk-a&start=600&end=660"
    retry_messages = []
    attempts = 0
    async with mcp_server(proposal, workstation=True) as (url, calls, _):

        def model(messages, info):
            nonlocal attempts
            attempts += 1
            if attempts == 3:
                assert tool_returned(messages, "prepare_booking")
                return answer(info, proposal=proposal)
            errors = [
                part
                for message in messages
                for part in message.parts
                if isinstance(part, ToolReturnPart)
                and part.tool_name == "prepare_booking"
                and part.outcome == "retried"
            ]
            if attempts == 2:
                assert errors
                retry_messages.extend(errors)
                return ModelResponse(
                    parts=[ToolCallPart("prepare_booking", {"officeId": "office-a"})]
                )
            return ModelResponse(
                parts=[ToolCallPart("prepare_booking", {"officeId": "office-a", "participants": 1})]
            )

        result = await run_agent(
            settings(url),
            "Нужно рабочее место для одного человека",
            [],
            {"officeId": "office-a"},
            "secret",
            model=FunctionModel(model),
        )
        assert result.reply.proposal.resourceId == "desk-a"
        assert result.reply.proposal.participants is None
        assert len(calls) == 2
        assert attempts == 3
        assert len(retry_messages) == 1
        assert "только для переговорной" in str(retry_messages[0].content)
        assert retry_messages[0].retry.cause == "model_retry"
        assert retry_messages[0].retry.max_retries == 1


async def test_real_mcp_persistent_business_error_exhausts_finite_retry_budget():
    attempts = 0
    async with mcp_server(always_fail=True) as (url, calls, _):

        def model(messages, info):
            nonlocal attempts
            attempts += 1
            return ModelResponse(
                parts=[ToolCallPart("prepare_booking", {"officeId": "office-a", "participants": 1})]
            )

        configuration = settings(url)
        configuration.generation_retry_limit = 1
        with pytest.raises(UnexpectedModelBehavior, match="retry"):
            await run_agent(
                configuration,
                "Нужно рабочее место",
                [],
                {"officeId": "office-a"},
                "secret",
                model=FunctionModel(model),
            )
        assert attempts == 2
        assert len(calls) == 2


def test_context_truncation_keeps_complete_run_groups_and_current_instructions_separate():
    old = [
        {"kind": "request", "parts": ["old call"]},
        {"kind": "response", "parts": ["old result"]},
    ]
    newest = [
        {"kind": "request", "parts": ["new call"]},
        {"kind": "response", "parts": ["new result"]},
    ]
    budget = len(json.dumps(newest, ensure_ascii=False, separators=(",", ":")))
    assert trim_history_chunks([old, newest], max_chars=budget, max_runs=6) == newest
    assert trim_history_chunks([old, newest], max_chars=1_000, max_runs=1) == newest
    assert trim_history_chunks([old, newest], max_chars=1_000, max_runs=0) == []
    assert trim_history_chunks([old, newest], max_chars=1, max_runs=6) == []


@pytest.mark.parametrize(
    "value",
    [
        {"proposal": {**PROPOSAL, "url": "https://other.example/steal"}},
        {"proposal": {**PROPOSAL, "start": 700}},
        {"proposal": {**PROPOSAL, "resourceId": ""}},
        {"error": "unavailable", "proposal": PROPOSAL},
        "Not a proposal",
    ],
)
def test_failed_or_invalid_tool_output_is_never_a_proposal(value):
    assert extract_prepared_proposal(value) is None


def test_mcp_json_text_result_supports_the_same_structured_proposal():
    assert extract_prepared_proposal(json.dumps({"proposal": PROPOSAL})).resourceId == "room-a"


@pytest.mark.parametrize(
    "fields",
    [{"date": None}, {"start": None}, {"end": None}, {"date": None, "start": None, "end": None}],
)
def test_partial_form_parameters_remain_a_valid_prepared_proposal(fields):
    result = extract_prepared_proposal({"proposal": {**PROPOSAL, **fields}})
    assert result is not None
    for key in fields:
        assert getattr(result, key) is None


@pytest.mark.parametrize(
    "url",
    [
        "https://other.example/booking?resourceId=room-a",
        "https://user:password@booking.example/booking?resourceId=room-a",
        "https://booking.example/booking?resourceId=room-a#fragment",
        "https://booking.example/booking?resourceId=room-a#",
        "//booking.example/booking?resourceId=room-a",
        "https://booking.example:8443/booking?resourceId=room-a",
        "https://booking.example:0/booking?resourceId=room-a",
        "https://booking.example/another?resourceId=room-a",
    ],
)
def test_preparation_rejects_external_origin_credentials_and_fragment(url):
    assert (
        extract_prepared_proposal(
            {"proposal": {**PROPOSAL, "url": url}}, allowed_origin="https://booking.example"
        )
        is None
    )


async def test_real_mcp_accepts_grounded_partial_proposal_at_configured_public_origin():
    partial = {
        **PROPOSAL,
        "date": None,
        "start": None,
        "end": None,
        "url": "https://booking.example/booking?resourceId=room-a",
    }
    async with mcp_server(partial) as (url, calls, credentials):

        def model(messages, info):
            if tool_returned(messages, "prepare_booking"):
                return answer(info, proposal=partial)
            return ModelResponse(parts=[ToolCallPart("prepare_booking", {"officeId": "office-a"})])

        configuration = settings(url)
        configuration.public_base_url = "https://booking.example"
        result = await run_agent(
            configuration,
            "Нужна комната",
            [],
            {"officeId": "office-a"},
            "secret",
            model=FunctionModel(model),
        )
        assert result.reply.proposal.url == partial["url"]
        assert result.reply.proposal.date is None
        assert result.reply.proposal.start is None
        assert result.reply.proposal.end is None
        assert calls == [("prepare_booking", "office-a")]
