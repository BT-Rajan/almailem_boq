#!/usr/bin/env bash
# Restore a backup into an EMPTY database and an EMPTY attachments directory.
#   DB_USER=<admin user> DB_PASSWORD=... DB_NAME=<new database> ATTACHMENTS_DIR=<empty dir> \
#   scripts/restore.sh /srv/boq/backups/boq-20261002T120000Z
# Needs a database user that may create tables and triggers (not the app's restricted user).
set -euo pipefail
source "$(dirname "$0")/lib.sh"
: "${ATTACHMENTS_DIR:?set ATTACHMENTS_DIR}"
base="${1:?usage: restore.sh <backup path without extension>}"

log "checking checksums"
(cd "$(dirname "$base")" && sha256sum -c "$(basename "$base").sha256")

db -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
tables="$(db -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$DB_NAME'")"
if [ "$tables" != "0" ]; then echo "database $DB_NAME is not empty; refusing to restore over it" >&2; exit 1; fi
mkdir -p "$ATTACHMENTS_DIR"
if [ -n "$(ls -A "$ATTACHMENTS_DIR")" ]; then echo "$ATTACHMENTS_DIR is not empty; refusing" >&2; exit 1; fi

log "restoring database into $DB_NAME"
# Drop DEFINER clauses so the triggers belong to whoever restores (accounts differ between servers).
gunzip -c "$base.sql.gz" | sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g' | db "$DB_NAME"

log "restoring attachments into $ATTACHMENTS_DIR"
tar -C "$ATTACHMENTS_DIR" -xzf "$base-attachments.tar.gz"
chmod -R go-rwx "$ATTACHMENTS_DIR"
log "restore complete"
