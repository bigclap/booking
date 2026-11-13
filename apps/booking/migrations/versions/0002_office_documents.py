"""Preserve office settings and exact constructor floor documents."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "booking_0002"
down_revision = "booking_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("buildings", sa.Column("updated_at", sa.DateTime(timezone=True)))
    # Old rows have no modification timestamp; creation is the known baseline.
    op.execute("UPDATE buildings SET updated_at = created_at")
    op.alter_column("buildings", "updated_at", nullable=False, server_default=sa.func.now())
    op.add_column("buildings", sa.Column("hours_document", postgresql.JSONB()))
    for table, columns in (
        ("buildings", ("id",)),
        ("building_working_hours", ("building_id",)),
        ("floors", ("id", "building_id", "name")),
        ("resources", ("id", "floor_id", "parent_room_id", "name")),
    ):
        for column in columns:
            op.alter_column(table, column, existing_type=sa.String(160), type_=sa.String(1000))


def downgrade():
    # Keep the wider identifiers: shrinking may truncate real constructor documents.
    op.drop_column("buildings", "hours_document")
    op.drop_column("buildings", "updated_at")
