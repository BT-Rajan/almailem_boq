#!/usr/bin/env bash
# Shared helpers for the backup scripts. Connection settings come from the environment:
#   DB_HOST (default 127.0.0.1)  DB_PORT (3306)  DB_USER  DB_PASSWORD  DB_NAME
# The password goes into a private temporary defaults file, never onto the command line.
set -euo pipefail

: "${DB_HOST:=127.0.0.1}" "${DB_PORT:=3306}"
: "${DB_USER:?set DB_USER}" "${DB_NAME:?set DB_NAME}"

DEFAULTS_FILE="$(mktemp)"
chmod 600 "$DEFAULTS_FILE"
trap 'rm -f "$DEFAULTS_FILE"' EXIT
{
  echo "[client]"
  echo "host=$DB_HOST"
  echo "port=$DB_PORT"
  echo "user=$DB_USER"
  if [ -n "${DB_PASSWORD:-}" ]; then echo "password=$DB_PASSWORD"; fi
} > "$DEFAULTS_FILE"

db() { mariadb --defaults-extra-file="$DEFAULTS_FILE" "$@"; }
dump() { mariadb-dump --defaults-extra-file="$DEFAULTS_FILE" "$@"; }
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
