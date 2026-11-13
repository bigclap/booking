"""Create the initial administrator explicitly; never reset an existing account."""

import asyncio
import os

from pydantic import ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from workplace_users.config import UsersSettings
from workplace_users.models import User
from workplace_users.schemas import UserCreate
from workplace_users.security import hash_password


class BootstrapAdminInput(UserCreate):
    """Explicit operator bootstrap may use a short password; ordinary API policy is unchanged."""

    model_config = ConfigDict(hide_input_in_errors=True)
    password: str = Field(min_length=1, max_length=1024, repr=False)


async def run() -> None:
    settings = UsersSettings()
    password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD")
    if not password:
        raise SystemExit("Set BOOTSTRAP_ADMIN_PASSWORD to create the initial administrator")
    body = BootstrapAdminInput(
        login=os.environ.get("BOOTSTRAP_ADMIN_LOGIN", "admin"),
        password=password,
        first_name=os.environ.get("BOOTSTRAP_ADMIN_FIRST_NAME", "Office"),
        last_name=os.environ.get("BOOTSTRAP_ADMIN_LAST_NAME", "Administrator"),
        role="admin",
    )
    engine = create_async_engine(settings.database_url)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            existing = await db.scalar(select(User).where(User.login == body.login))
            if existing is not None:
                print("Account already exists; no changes made")
                return
            db.add(
                User(
                    **body.model_dump(exclude={"password"}),
                    password_hash=await asyncio.to_thread(hash_password, body.password),
                )
            )
            await db.commit()
            print("Initial administrator created")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
