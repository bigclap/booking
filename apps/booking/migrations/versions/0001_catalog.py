"""Initial office catalog and local transactional outbox."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "booking_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "buildings",
        sa.Column("id", sa.String(160), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("address", sa.String(320)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "building_working_hours",
        sa.Column("building_id", sa.String(160), sa.ForeignKey("buildings.id"), primary_key=True),
        sa.Column("weekday", sa.Integer(), primary_key=True),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="working_hours_weekday"),
        sa.CheckConstraint("start_time < end_time", name="working_hours_order"),
    )
    op.create_table(
        "floors",
        sa.Column("id", sa.String(160), primary_key=True),
        sa.Column("building_id", sa.String(160), sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("plan_document", postgresql.JSONB()),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_floors_building_id", "floors", ["building_id"])
    op.create_table(
        "resources",
        sa.Column("id", sa.String(160), primary_key=True),
        sa.Column("floor_id", sa.String(160), sa.ForeignKey("floors.id"), nullable=False),
        sa.Column("parent_room_id", sa.String(160), sa.ForeignKey("resources.id")),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("shared_booking", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("kind IN ('workstation', 'meeting_room')", name="resource_kind"),
        sa.CheckConstraint(
            "parent_room_id IS NULL OR parent_room_id <> id", name="resource_parent"
        ),
    )
    op.create_index("ix_resources_floor_id", "resources", ["floor_id"])
    op.create_index("ix_resources_parent_room_id", "resources", ["parent_room_id"])
    op.create_table(
        "outbox_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text()),
    )


def downgrade():
    op.drop_table("outbox_events")
    op.drop_table("resources")
    op.drop_table("floors")
    op.drop_table("building_working_hours")
    op.drop_table("buildings")
