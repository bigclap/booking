import asyncio
import json
import os
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from pydantic_ai import RunContext, models
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.models.test import TestModel
from pydantic_ai.toolsets import FunctionToolset
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_assistant.config import AssistantSettings
from workplace_assistant.db import get_session
from workplace_assistant.generation_models import GenerationRequest
from workplace_assistant.generation_routes import create_generation_router, enqueue_message
from workplace_assistant.generation_schemas import MessageInput
from workplace_assistant.generation_worker import GenerationBusy, claim_request, process_generation
from workplace_assistant.models import Base, ChatMessage, ChatSession, OutboxEvent
from workplace_assistant.repository import new_dialogue
from workplace_assistant.runtime import (
    RuntimeDependencies,
    process_tool_call,
    run_agent,
    trim_history_chunks,
)
from workplace_platform.auth import Actor, encode_actor

KEY = "test-assistant-internal-key-long-enough"
CONTEXT = {"officeId": "office-selected", "floorId": "floor-1", "date": "2026-11-12"}
TRUSTED_PROPOSAL = {
    "officeId": "office-selected",
    "floorId": "floor-1",
    "resourceId": "room-1",
    "date": "2026-11-12",
    "start": 600,
    "end": 660,
    "participants": 3,
}


@pytest.fixture
def settings():
    return AssistantSettings(
        internal_api_key=KEY,
        openrouter_api_key="offline-test-key",
        openrouter_model="offline-test-model",
    )


@pytest.fixture(autouse=True)
def no_paid_requests(monkeypatch):
    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)


@pytest.fixture
async def generation_sessions():
    url = os.environ.get("TEST_ASSISTANT_DATABASE_URL")
    if not url:
        pytest.skip("Requires isolated Docker PostgreSQL")
    schema = f"generation_test_{uuid4().hex}"
    control = create_async_engine(url)
    async with control.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()
        async with control.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await control.dispose()


@pytest.fixture
async def generation_api(generation_sessions, settings):
    actor = Actor(
        user_id=str(uuid4()),
        session_id=str(uuid4()),
        role="employee",
        building_ids=["office-selected"],
        first_name="Test",
        last_name="Employee",
    )
    async with generation_sessions() as session, session.begin():
        dialogue_id = (await new_dialogue(session, uuid4())).id
        own_id = (await new_dialogue(session, actor.user_id)).id
    app = FastAPI()
    app.state.settings = settings
    app.include_router(create_generation_router(get_session))

    async def db():
        async with generation_sessions() as session:
            yield session

    app.dependency_overrides[get_session] = db
    headers = {"X-Internal-Key": KEY, "X-Actor-Context": encode_actor(actor)}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://assistant",
        headers=headers,
    ) as client:
        yield client, actor, own_id, dialogue_id


async def send(client, session_id, *, key=None, message="Нужна переговорная"):
    return await client.post(
        f"/internal/chats/{session_id}/messages",
        headers={"Idempotency-Key": key or str(uuid4())},
        json={"message": message, "context": CONTEXT},
    )


@pytest.mark.integration
async def test_concurrent_messages_share_one_slot_and_idempotent_replay(
    generation_api, generation_sessions
):
    client, _, own_id, foreign_id = generation_api
    key = str(uuid4())
    responses = await asyncio.gather(send(client, own_id, key=key), send(client, own_id))
    assert sorted(response.status_code for response in responses) == [202, 409]
    accepted = next(response for response in responses if response.status_code == 202)
    # Replay the accepted request's own key, independently of which concurrent request won.
    async with generation_sessions() as session:
        request = (await session.scalars(select(GenerationRequest))).one()
        replay_key = request.idempotency_key
    replay = await send(client, own_id, key=replay_key)
    assert replay.status_code == 202
    assert replay.json()["request"]["id"] == accepted.json()["request"]["id"]
    assert (await send(client, own_id, key=replay_key, message="Другой запрос")).status_code == 409
    assert (await send(client, foreign_id)).status_code == 404
    async with generation_sessions() as session:
        assert await session.scalar(select(func.count()).select_from(GenerationRequest)) == 1
        assert await session.scalar(select(func.count()).select_from(ChatMessage)) == 1
        assert (
            await session.scalar(
                select(func.count())
                .select_from(OutboxEvent)
                .where(
                    OutboxEvent.subject == "workplace.assistant.generation_requested",
                )
            )
            == 1
        )


@pytest.mark.integration
async def test_archived_or_unconfigured_dialogue_does_not_enqueue(
    generation_api, generation_sessions, settings
):
    client, actor, own_id, _ = generation_api
    async with generation_sessions() as session, session.begin():
        active_id = (await new_dialogue(session, actor.user_id)).id
    assert (await send(client, own_id)).status_code == 409
    settings.openrouter_model = None
    unavailable = await send(client, active_id)
    assert unavailable.status_code == 503
    assert unavailable.json()["detail"]["code"] == "assistant_unconfigured"
    async with generation_sessions() as session:
        assert await session.scalar(select(func.count()).select_from(GenerationRequest)) == 0
        assert await session.scalar(select(func.count()).select_from(ChatMessage)) == 0


async def test_official_agent_uses_test_model_and_grounded_prepare_output(settings):
    tools = FunctionToolset()

    @tools.tool(name="prepare_booking")
    async def prepare(ctx: RunContext[RuntimeDependencies]) -> dict:
        async def call(name, arguments):
            return {"url": "/booking?resourceId=room-1", "proposal": TRUSTED_PROPOSAL}

        return await process_tool_call(ctx, call, "prepare_booking", {})

    result = await run_agent(
        settings,
        "Подбери комнату",
        [],
        CONTEXT,
        "delegated-secret-never-in-prompt",
        model=TestModel(
            call_tools=["prepare_booking"],
            custom_output_args={
                "message": "Проверьте предложение в форме.",
                "proposal": TRUSTED_PROPOSAL,
            },
        ),
        toolsets=[tools],
    )
    assert result.reply.proposal.resourceId == "room-1"
    assert result.reply.proposal.url == "/booking?resourceId=room-1"
    encoded = json.dumps(result.run_messages, ensure_ascii=False)
    assert "prepare_booking" in encoded
    assert "tool-call" in encoded and "tool-return" in encoded
    assert "delegated-secret-never-in-prompt" not in encoded
    trimmed = trim_history_chunks([result.run_messages] * 3, max_runs=1, max_chars=100000)
    assert trimmed == result.run_messages
    assert trim_history_chunks([result.run_messages], max_runs=1, max_chars=1) == []


async def test_model_cannot_invent_a_proposal_without_prepare_tool_result(settings):
    with pytest.raises(UnexpectedModelBehavior):
        await run_agent(
            settings,
            "Подбери комнату",
            [],
            CONTEXT,
            "test-token",
            model=TestModel(
                custom_output_args={"message": "Вариант", "proposal": TRUSTED_PROPOSAL}
            ),
            toolsets=[],
        )


async def fake_delegate(settings, claimed):
    return "offline-delegated-token"


async def offline_runner(settings, prompt, history, context, token):
    return await run_agent(
        settings,
        prompt,
        history,
        context,
        token,
        model=TestModel(custom_output_args={"message": "Уточните время", "proposal": None}),
        toolsets=[],
    )


async def queued_request(sessions, settings):
    actor = Actor(
        user_id=str(uuid4()),
        session_id=str(uuid4()),
        role="employee",
        building_ids=["office-selected"],
        first_name="Test",
        last_name="Owner",
    )
    async with sessions() as session, session.begin():
        dialogue_id = (await new_dialogue(session, actor.user_id)).id
    async with sessions() as session:
        request = await enqueue_message(
            session,
            actor,
            dialogue_id,
            MessageInput(message="Нужна комната", context=CONTEXT),
            str(uuid4()),
            settings,
        )
    return actor, dialogue_id, request.id


@pytest.mark.integration
async def test_worker_persists_real_sdk_history_and_does_not_repeat_finished_request(
    generation_sessions, settings
):
    _, dialogue_id, request_id = await queued_request(generation_sessions, settings)
    calls = 0

    async def counted(*args):
        nonlocal calls
        calls += 1
        return await offline_runner(*args)

    assert await process_generation(
        generation_sessions,
        request_id,
        settings,
        runner=counted,
        delegate=fake_delegate,
    )
    assert not await process_generation(
        generation_sessions,
        request_id,
        settings,
        runner=counted,
        delegate=fake_delegate,
    )
    assert calls == 1
    async with generation_sessions() as session:
        request = await session.get(GenerationRequest, request_id)
        assert request.status == "completed"
        assert request.run_messages
        assert request.result["message"] == "Уточните время"
        assert (await session.get(ChatSession, dialogue_id)).in_flight_request_id is None
        assert await session.scalar(select(func.count()).select_from(ChatMessage)) == 2


@pytest.mark.integration
async def test_timeout_releases_dialogue_slot_and_preserves_error(generation_sessions, settings):
    actor, dialogue_id, request_id = await queued_request(generation_sessions, settings)

    async def timeout(*args):
        raise TimeoutError()

    assert await process_generation(
        generation_sessions,
        request_id,
        settings,
        runner=timeout,
        delegate=fake_delegate,
    )
    async with generation_sessions() as session:
        request = await session.get(GenerationRequest, request_id)
        assert request.status == "failed"
        assert request.error_code == "assistant_timeout"
        assert (await session.get(ChatSession, dialogue_id)).in_flight_request_id is None
    async with generation_sessions() as session:
        retried = await enqueue_message(
            session,
            actor,
            dialogue_id,
            MessageInput(message="Попробуем снова", context=CONTEXT),
            str(uuid4()),
            settings,
        )
        assert retried.id != request_id


@pytest.mark.integration
async def test_late_worker_reply_is_saved_to_original_archived_dialogue(
    generation_sessions, settings
):
    actor, old_id, request_id = await queued_request(generation_sessions, settings)
    started, finish = asyncio.Event(), asyncio.Event()

    async def delayed(*args):
        started.set()
        await finish.wait()
        return await offline_runner(*args)

    worker = asyncio.create_task(
        process_generation(
            generation_sessions,
            request_id,
            settings,
            runner=delayed,
            delegate=fake_delegate,
        )
    )
    await asyncio.wait_for(started.wait(), timeout=5)
    async with generation_sessions() as session, session.begin():
        new_id = (await new_dialogue(session, actor.user_id)).id
    finish.set()
    await worker
    async with generation_sessions() as session:
        old = await session.get(ChatSession, old_id)
        assert old.archived_at is not None
        assert old.in_flight_request_id is None
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ChatMessage)
                .where(
                    ChatMessage.session_id == old_id,
                )
            )
            == 2
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ChatMessage)
                .where(
                    ChatMessage.session_id == new_id,
                )
            )
            == 0
        )
        assert (await session.get(ChatSession, new_id)).archived_at is None


@pytest.mark.integration
async def test_expired_lease_is_recovered_and_exhausted_attempts_release_slot(
    generation_sessions, settings
):
    _, dialogue_id, request_id = await queued_request(generation_sessions, settings)
    first = await claim_request(generation_sessions, request_id, settings)
    assert first is not None
    with pytest.raises(GenerationBusy):
        await claim_request(generation_sessions, request_id, settings)
    async with generation_sessions() as session, session.begin():
        now = await session.scalar(select(func.clock_timestamp()))
        await session.execute(
            update(GenerationRequest)
            .where(GenerationRequest.id == request_id)
            .values(
                lease_until=now - timedelta(seconds=1),
                attempts=settings.generation_attempt_limit,
            )
        )
    assert not await process_generation(
        generation_sessions,
        request_id,
        settings,
        runner=offline_runner,
        delegate=fake_delegate,
    )
    async with generation_sessions() as session:
        request = await session.get(GenerationRequest, request_id)
        assert request.status == "failed"
        assert request.error_code == "assistant_attempts_exhausted"
        assert (await session.get(ChatSession, dialogue_id)).in_flight_request_id is None


@pytest.mark.integration
async def test_archiving_does_not_allow_second_generation_for_same_user(
    generation_sessions, settings
):
    actor, _, request_id = await queued_request(generation_sessions, settings)
    async with generation_sessions() as session, session.begin():
        new_id = (await new_dialogue(session, actor.user_id)).id
    from fastapi import HTTPException

    async with generation_sessions() as session:
        with pytest.raises(HTTPException) as denied:
            await enqueue_message(
                session,
                actor,
                new_id,
                MessageInput(message="Ещё сообщение", context=CONTEXT),
                str(uuid4()),
                settings,
            )
        assert denied.value.status_code == 409
        assert denied.value.detail["code"] == "assistant_busy"
    await process_generation(
        generation_sessions, request_id, settings, runner=offline_runner, delegate=fake_delegate
    )
    async with generation_sessions() as session:
        request = await enqueue_message(
            session,
            actor,
            new_id,
            MessageInput(message="Теперь можно", context=CONTEXT),
            str(uuid4()),
            settings,
        )
        assert request.session_id == new_id


@pytest.mark.integration
async def test_reload_snapshot_restores_global_processing_and_terminal_error(
    generation_sessions, settings
):
    from workplace_assistant.main import create_application

    actor, old_id, request_id = await queued_request(generation_sessions, settings)
    app = create_application(settings)

    async def db():
        async with generation_sessions() as session:
            yield session

    app.dependency_overrides[get_session] = db
    headers = {"X-Internal-Key": KEY, "X-Actor-Context": encode_actor(actor)}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://assistant", headers=headers
    ) as client:
        current = (await client.get("/internal/chats/current")).json()
        assert current["request"]["id"] == str(request_id)
        assert current["processing"]["status"] == "pending"
        new = await client.post("/internal/chats/new")
        assert new.status_code == 201
        new_id = new.json()["session"]["id"]
        restored = (await client.get("/internal/chats/current")).json()
        assert restored["session"]["id"] == new_id
        assert restored["request"] is None
        assert restored["processing"]["session_id"] == str(old_id)

        async def timeout(*args):
            raise TimeoutError()

        await process_generation(
            generation_sessions, request_id, settings, runner=timeout, delegate=fake_delegate
        )
        restored = (await client.get("/internal/chats/current")).json()
        assert restored["processing"] is None
        old = (await client.get(f"/internal/chats/{old_id}")).json()
        assert old["request"]["status"] == "failed"
        assert old["request"]["error_code"] == "assistant_timeout"
