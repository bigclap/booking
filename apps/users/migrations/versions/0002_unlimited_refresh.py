"""Web refresh sessions have no age-based expiration (D-123)."""

import sqlalchemy as sa
from alembic import op

revision = "0002_unlimited_refresh"
down_revision = "0001_users"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "sessions", "expires_at", existing_type=sa.DateTime(timezone=True), nullable=True
    )
    # Retain revocation and historical records, while removing the superseded age limit.
    op.execute("UPDATE sessions SET expires_at = NULL WHERE revoked_at IS NULL")


def downgrade():
    op.execute(
        "UPDATE sessions SET expires_at = created_at + INTERVAL '30 days' WHERE expires_at IS NULL"
    )
    op.alter_column(
        "sessions", "expires_at", existing_type=sa.DateTime(timezone=True), nullable=False
    )
