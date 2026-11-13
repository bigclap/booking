#!/bin/sh
set -eu

cleanup() {
  docker compose -f compose.test.yaml down --volumes --remove-orphans
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker compose -f compose.test.yaml up -d --wait postgres nats
docker compose -f compose.test.yaml run --rm --no-deps tests "$@"
