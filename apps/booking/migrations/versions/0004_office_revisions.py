"""Optimistic office revision and idempotent legacy import receipts."""

import sqlalchemy as sa
from alembic import op

revision = "booking_0004"
down_revision = "booking_0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "buildings", sa.Column("revision", sa.Integer(), nullable=False, server_default="1")
    )
    op.create_table(
        "office_import_receipts",
        sa.Column("actor_id", sa.String(160), primary_key=True),
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("office_id", sa.String(1000), sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_office_import_receipts_office_id", "office_import_receipts", ["office_id"])


def downgrade():
    op.drop_table("office_import_receipts")
    op.drop_column("buildings", "revision")
