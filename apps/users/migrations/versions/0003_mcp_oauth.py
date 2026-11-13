"""Persist resource-bound MCP OAuth clients, grants, and revocable opaque credentials."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003_mcp_oauth"
down_revision = "0002_unlimited_refresh"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "mcp_clients",
        sa.Column("id", sa.String(160), primary_key=True),
        sa.Column("metadata_document", postgresql.JSONB(), nullable=False),
        sa.Column("secret_ciphertext", sa.Text()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "mcp_authorization_requests",
        sa.Column("handle_hash", sa.String(64), primary_key=True),
        sa.Column("client_id", sa.String(160), sa.ForeignKey("mcp_clients.id"), nullable=False),
        sa.Column("parameters", postgresql.JSONB(), nullable=False),
        sa.Column("csrf_hash", sa.String(64)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "mcp_authorization_codes",
        sa.Column("code_hash", sa.String(64), primary_key=True),
        sa.Column("client_id", sa.String(160), sa.ForeignKey("mcp_clients.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("parameters", postgresql.JSONB(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "mcp_tokens",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("client_id", sa.String(160), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("resource", sa.Text(), nullable=False),
        sa.Column("scopes", postgresql.JSONB(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("kind IN ('access', 'refresh')", name="mcp_token_kind"),
    )
    for column in ("user_id", "session_id", "family_id", "expires_at"):
        op.create_index(f"ix_mcp_tokens_{column}", "mcp_tokens", [column])


def downgrade():
    op.drop_table("mcp_tokens")
    op.drop_table("mcp_authorization_codes")
    op.drop_table("mcp_authorization_requests")
    op.drop_table("mcp_clients")
