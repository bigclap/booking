"""Explain review flags and preserve booking mutation/resource snapshots."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "booking_0006"
down_revision = "booking_0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "bookings",
        sa.Column("review_reasons", postgresql.JSONB(), server_default="[]", nullable=False),
    )
    op.add_column(
        "bookings",
        sa.Column("resource_snapshot", postgresql.JSONB(), server_default="{}", nullable=False),
    )
    op.add_column("bookings", sa.Column("cancellation_reason", sa.String(160)))
    op.create_table(
        "booking_mutations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("booking_id", sa.String(1000), sa.ForeignKey("bookings.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("operation", sa.String(64), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column(
            "occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("booking_id", "revision", name="booking_mutation_revision"),
    )
    op.create_index("ix_booking_mutations_booking_id", "booking_mutations", ["booking_id"])
    # Keep an honest baseline for records predating this audit trail.
    op.execute("""
        INSERT INTO booking_mutations (id, booking_id, revision, operation, snapshot)
        SELECT 'baseline-' || md5(id), id, revision, 'migrated_baseline', to_jsonb(bookings)
        FROM bookings
    """)


def downgrade():
    op.drop_table("booking_mutations")
    op.drop_column("bookings", "cancellation_reason")
    op.drop_column("bookings", "resource_snapshot")
    op.drop_column("bookings", "review_reasons")
