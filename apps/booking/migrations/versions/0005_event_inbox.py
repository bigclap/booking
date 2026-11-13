"""Durable idempotency for Users business-event consumption."""

import sqlalchemy as sa
from alembic import op

revision = "booking_0005"
down_revision = "booking_0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "inbox_events",
        sa.Column("event_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "processed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade():
    op.drop_table("inbox_events")
