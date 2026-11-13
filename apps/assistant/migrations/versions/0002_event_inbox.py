"""Durable receipt for booking-created conversation archival."""

import sqlalchemy as sa
from alembic import op

revision = "assistant_0002"
down_revision = "assistant_0001"
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
