"""Persist bookings and user-bound idempotent confirmations."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "booking_0003"
down_revision = "booking_0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "bookings",
        sa.Column("id", sa.String(1000), primary_key=True),
        sa.Column("building_id", sa.String(1000), sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("floor_id", sa.String(1000), sa.ForeignKey("floors.id"), nullable=False),
        sa.Column("resource_id", sa.String(1000), sa.ForeignKey("resources.id"), nullable=False),
        sa.Column("ancestor_ids", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("owner_id", sa.String(1000), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("participants", sa.Integer()),
        sa.Column("status", sa.String(16), server_default="active", nullable=False),
        sa.Column("needs_review", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("status IN ('active', 'cancelled')", name="booking_status"),
        sa.CheckConstraint("starts_at < ends_at", name="booking_time_order"),
        sa.CheckConstraint("participants IS NULL OR participants > 0", name="booking_participants"),
        sa.CheckConstraint("revision > 0", name="booking_revision"),
    )
    for column in ("building_id", "floor_id", "resource_id", "owner_id", "starts_at"):
        op.create_index(f"ix_bookings_{column}", "bookings", [column])
    op.create_table(
        "booking_confirmations",
        sa.Column("actor_id", sa.String(1000), primary_key=True),
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("booking_id", sa.String(1000), sa.ForeignKey("bookings.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_booking_confirmations_booking_id", "booking_confirmations", ["booking_id"])


def downgrade():
    op.drop_table("booking_confirmations")
    op.drop_table("bookings")
