#!/bin/sh
set -eu

# Runs only when PostgreSQL initializes a new Docker volume. SQL values are quoted by psql.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --set users_password="$USERS_DB_PASSWORD" \
  --set booking_password="$BOOKING_DB_PASSWORD" \
  --set assistant_password="$ASSISTANT_DB_PASSWORD" <<'SQL'
CREATE ROLE workplace_users LOGIN PASSWORD :'users_password';
CREATE ROLE workplace_booking LOGIN PASSWORD :'booking_password';
CREATE ROLE workplace_assistant LOGIN PASSWORD :'assistant_password';
CREATE DATABASE users OWNER workplace_users;
CREATE DATABASE booking OWNER workplace_booking;
CREATE DATABASE assistant OWNER workplace_assistant;
REVOKE CONNECT ON DATABASE users FROM PUBLIC;
REVOKE CONNECT ON DATABASE booking FROM PUBLIC;
REVOKE CONNECT ON DATABASE assistant FROM PUBLIC;
GRANT CONNECT ON DATABASE users TO workplace_users;
GRANT CONNECT ON DATABASE booking TO workplace_booking;
GRANT CONNECT ON DATABASE assistant TO workplace_assistant;
SQL
