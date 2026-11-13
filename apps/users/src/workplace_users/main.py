import asyncio
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from workplace_platform.auth import require_internal_key
from workplace_platform.correlation import event_metadata
from workplace_platform.jwt_tokens import issue_access, signing_key
from workplace_platform.typing import JsonObject, SessionFactory
from workplace_platform.web import create_app

from workplace_users.config import UsersSettings
from workplace_users.models import AccessOperation, OutboxEvent, Session, User
from workplace_users.schemas import (
    Actor,
    LoginInput,
    LoginResult,
    PasswordChange,
    PasswordReset,
    TokenInput,
    UserCreate,
    UserLookup,
    UserPatch,
    UserView,
)
from workplace_users.security import hash_password, issue_token, token_digest, verify_password


def failure(status: int, code: str) -> HTTPException:
    return HTTPException(status, detail={"code": code})


async def database(request: Request) -> AsyncIterator[AsyncSession]:
    sessions = cast(SessionFactory, request.app.state.sessions)
    async with sessions() as session:
        yield session


Database = Annotated[AsyncSession, Depends(database)]


@dataclass
class Authenticated:
    user: User
    session: Session | None = None


@dataclass
class AuthenticatedSession:
    user: User
    session: Session


async def resolve_session(
    db: AsyncSession, token: str, *, lock: bool = False
) -> AuthenticatedSession:
    if lock:
        owner = await db.scalar(
            select(Session.user_id).where(Session.token_hash == token_digest(token))
        )
        if owner is None:
            raise failure(401, "session_invalid")
        await db.scalar(select(User).where(User.id == owner).with_for_update())
    result = await db.execute(
        select(User, Session)
        .join(Session, Session.user_id == User.id)
        .where(
            Session.token_hash == token_digest(token),
            or_(Session.expires_at.is_(None), Session.expires_at > func.now()),
            Session.revoked_at.is_(None),
            User.active.is_(True),
        )
    )
    pair = result.one_or_none()
    if pair is None:
        raise failure(401, "session_invalid")
    return AuthenticatedSession(user=pair[0], session=pair[1])


async def current_user(
    db: Database,
    actor_id: Annotated[UUID, Header(alias="X-User-ID")],
) -> Authenticated:
    # Gateway has already authorized the command. This lookup supplies domain facts,
    # not another copy of role, active-account or refresh-session authorization.
    user = await db.get(User, actor_id)
    if user is None:
        raise failure(404, "user_not_found")
    return Authenticated(user=user)


CurrentUser = Annotated[Authenticated, Depends(current_user)]


async def administrator(current: CurrentUser) -> Authenticated:
    # The internal service credential identifies a trusted Gateway caller.
    # Employee/admin policy is enforced once at the public Gateway boundary (D-117).
    return current


Administrator = Annotated[Authenticated, Depends(administrator)]


type EventValue = str | int | bool | None | list[str]


def emit(db: AsyncSession, subject: str, user: User, **data: EventValue) -> None:
    db.add(
        OutboxEvent(
            subject=f"workplace.users.{subject}",
            payload=cast(JsonObject, {"user_id": str(user.id), **event_metadata(), **data}),
        )
    )


async def revoke_sessions(db: AsyncSession, user_id: UUID, reason: str) -> None:
    await db.execute(
        update(Session)
        .where(Session.user_id == user_id, Session.revoked_at.is_(None))
        .values(revoked_at=func.now(), revoke_reason=reason)
    )
    # Official MCP provider ties codes/access/refresh to these same Users sessions;
    # its identity() rejects revoked sessions, including pending authorization codes.


def revoke_access(
    db: AsyncSession, request: Request, user: User, subject: str, **scope: list[str]
) -> UUID:
    correlation_id = getattr(request.state, "request_id", None)
    if not isinstance(correlation_id, str):
        correlation_id = None
    operation = AccessOperation(
        id=uuid4(),
        user_id=user.id,
        reason=subject,
        scope=cast(JsonObject, scope or {"all_buildings": True}),
        correlation_id=correlation_id,
    )
    db.add(operation)
    emit(
        db,
        subject,
        user,
        operation_id=str(operation.id),
        reason=subject,
        correlation_id=operation.correlation_id,
        **scope,
    )
    return operation.id


router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal_key)])


def login_result(user: User, session: Session, token: str, settings: UsersSettings) -> LoginResult:
    view = UserView.model_validate(user)
    access_token, access_expires_at = issue_access(
        view.model_dump(mode="json"),
        str(session.id),
        session.expires_at,
        settings,
    )
    return LoginResult(
        token=token,
        user=view,
        expires_at=session.expires_at,
        access_token=access_token,
        access_expires_at=access_expires_at,
    )


@router.post("/auth/login", response_model=LoginResult)
async def login(body: LoginInput, db: Database, request: Request) -> LoginResult:
    # Serialize login against password resets and disable operations on this account.
    user = await db.scalar(
        select(User).where(User.login == body.login.strip().casefold()).with_for_update()
    )
    valid = await asyncio.to_thread(
        verify_password, body.password, user.password_hash if user else None
    )
    if user is None or not valid or not user.active:
        raise failure(401, "invalid_credentials")
    token = issue_token()
    session = Session(user_id=user.id, token_hash=token_digest(token), expires_at=None)
    db.add(session)
    await db.commit()
    return login_result(user, session, token, cast(UsersSettings, request.app.state.settings))


@router.post("/auth/refresh", response_model=LoginResult)
async def refresh(body: TokenInput, db: Database, request: Request) -> LoginResult:
    current = await resolve_session(db, body.token, lock=True)
    return login_result(
        current.user, current.session, body.token, cast(UsersSettings, request.app.state.settings)
    )


@router.post("/auth/introspect", response_model=Actor)
async def introspect(body: TokenInput, db: Database) -> Actor:
    current = await resolve_session(db, body.token)
    return Actor(
        user_id=current.user.id,
        session_id=current.session.id,
        role=current.user.role,
        building_ids=current.user.building_ids,
        first_name=current.user.first_name,
        last_name=current.user.last_name,
    )


@router.post("/auth/logout", status_code=204)
async def logout(body: TokenInput, db: Database) -> Response:
    # Idempotent logout also works after an admin has already revoked this token.
    await db.execute(
        update(Session)
        .where(Session.token_hash == token_digest(body.token), Session.revoked_at.is_(None))
        .values(revoked_at=func.now(), revoke_reason="logout")
    )
    await db.commit()
    return Response(status_code=204)


@router.get("/auth/me", response_model=UserView)
async def me(current: CurrentUser) -> User:
    return current.user


@router.post("/auth/password", status_code=204)
async def change_password(body: PasswordChange, current: CurrentUser, db: Database) -> Response:
    user = await db.scalar(
        select(User)
        .where(User.id == current.user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise failure(404, "user_not_found")
    if not await asyncio.to_thread(verify_password, body.current_password, user.password_hash):
        raise failure(400, "current_password_incorrect")
    user.password_hash = await asyncio.to_thread(hash_password, body.password)
    await revoke_sessions(db, user.id, "password_changed")
    emit(db, "password_changed", user)
    await db.commit()
    return Response(status_code=204)


@router.get("/users", response_model=list[UserView])
async def list_users(admin: Administrator, db: Database) -> Sequence[User]:
    return (await db.scalars(select(User).order_by(User.created_at, User.id))).all()


@router.get("/users/{user_id}", response_model=UserView)
async def user_facts(user_id: UUID, db: Database) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise failure(404, "user_not_found")
    return user


@router.post("/users/lookup", response_model=list[UserView])
async def user_lookup(body: UserLookup, db: Database) -> Sequence[User]:
    # Private facts for Gateway joins. User-facing visibility is enforced there.
    return (await db.scalars(select(User).where(User.id.in_(body.ids)))).all()


@router.post("/users", response_model=UserView, status_code=201)
async def create_user(body: UserCreate, admin: Administrator, db: Database) -> User:
    user = User(
        **body.model_dump(exclude={"password"}),
        password_hash=await asyncio.to_thread(hash_password, body.password),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise failure(409, "login_already_exists") from exc
    return user


@router.patch("/users/{user_id}", response_model=UserView)
async def update_user(
    user_id: UUID,
    body: UserPatch,
    admin: Administrator,
    db: Database,
    request: Request,
    response: Response,
) -> User:
    user = await db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise failure(404, "user_not_found")
    previous_active = user.active
    previous_grants = set(user.building_ids)
    previous_role = user.role
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    # Flush before any side effects: a duplicate login must roll back the whole patch.
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise failure(409, "login_already_exists") from exc
    if previous_active and not user.active:
        await revoke_sessions(db, user.id, "user_disabled")
        operation_id = revoke_access(db, request, user, "user_disabled")
        response.headers["X-Access-Operation-ID"] = str(operation_id)
    # Administrators retain every building regardless of their employee grant list.
    # A disable command already removes all access, so do not enqueue overlapping work.
    if previous_active and user.active and user.role == "employee":
        if previous_role == "admin":
            operation_id = revoke_access(
                db, request, user, "building_access_revoked", except_building_ids=user.building_ids
            )
            response.headers["X-Access-Operation-ID"] = str(operation_id)
        else:
            removed = sorted(previous_grants - set(user.building_ids))
            if removed:
                operation_id = revoke_access(
                    db, request, user, "building_access_revoked", building_ids=removed
                )
                response.headers["X-Access-Operation-ID"] = str(operation_id)
    if previous_role != user.role:
        emit(db, "role_changed", user, old_role=previous_role, role=user.role)
    await db.commit()
    return user


@router.post("/users/{user_id}/password", status_code=204)
async def reset_password(
    user_id: UUID, body: PasswordReset, admin: Administrator, db: Database
) -> Response:
    user = await db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise failure(404, "user_not_found")
    user.password_hash = await asyncio.to_thread(hash_password, body.password)
    await revoke_sessions(db, user.id, "password_reset")
    emit(db, "password_changed", user)
    await db.commit()
    return Response(status_code=204)


def create_application(settings: UsersSettings, engine: AsyncEngine | None = None) -> FastAPI:
    from workplace_users.mcp_auth import create_mcp_internal_router, create_oauth_app
    from workplace_users.operations import router as operations_router

    signing_key(settings)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        own_engine = engine is None
        db_engine = engine or create_async_engine(settings.database_url, pool_pre_ping=True)
        sessions = async_sessionmaker(db_engine, expire_on_commit=False)
        application.state.sessions = sessions
        if settings.mcp_encryption_key is not None:
            application.mount("/oauth", create_oauth_app(settings, sessions))
        try:
            yield
        finally:
            if own_engine:
                await db_engine.dispose()

    application = create_app("users", settings, lifespan=lifespan)
    application.include_router(router)
    application.include_router(operations_router)
    application.include_router(create_mcp_internal_router())

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Pydantic's default includes rejected input, which may contain credentials.
        return JSONResponse(status_code=422, content={"detail": {"code": "validation_error"}})

    return application


app = create_application(UsersSettings())
