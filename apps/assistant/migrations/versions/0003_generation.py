"""Durable asynchronous generation, complete SDK history chunks and structured proposals."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "assistant_0003"
down_revision = "assistant_0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("chat_messages", sa.Column("proposal", JSONB()))
    op.create_table(
        "generation_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("gateway_session_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("chat_sessions.id"), nullable=False),
        sa.Column("user_message_id", sa.Uuid(), sa.ForeignKey("chat_messages.id"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("context", JSONB(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_token", sa.Uuid()),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("run_messages", JSONB()),
        sa.Column("result", JSONB()),
        sa.Column("error_code", sa.String(80)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.clock_timestamp(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.clock_timestamp(),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("actor_id", "idempotency_key", name="uq_generation_actor_key"),
        sa.CheckConstraint(
            "status IN ('pending','running','completed','failed')", name="generation_status"
        ),
    )
    op.create_index("ix_generation_requests_actor_id", "generation_requests", ["actor_id"])
    op.create_index("ix_generation_requests_session_id", "generation_requests", ["session_id"])


def downgrade():
    op.drop_table("generation_requests")
    op.drop_column("chat_messages", "proposal")
