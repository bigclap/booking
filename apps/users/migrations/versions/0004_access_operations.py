"""Track durable access-revocation outcomes without altering historical identities."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004_access_operations"
down_revision = "0003_mcp_oauth"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.add_column("sessions", sa.Column("revoke_reason", sa.String(80), nullable=True))
    op.create_table(
        "access_operations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.String(80), nullable=False),
        sa.Column("scope", JSONB(), nullable=False),
        sa.Column("correlation_id", sa.String(80), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("cancelled_count", sa.Integer(), nullable=False),
        sa.Column("terminated_count", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'completed')", name="access_operation_status"),
    )
    op.create_index("ix_access_operations_user_id", "access_operations", ["user_id"])
    op.create_table(
        "inbox_events",
        sa.Column("event_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "processed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade():
    op.drop_table("inbox_events")
    op.drop_table("access_operations")
    op.drop_column("sessions", "revoke_reason")
    op.drop_column("users", "updated_at")
