#!/usr/bin/env bash
# Back up the database and the attachment files together, so they always match.
#   DB_USER=... DB_PASSWORD=... DB_NAME=boq ATTACHMENTS_DIR=/srv/boq/attachments \
#   BACKUP_DIR=/srv/boq/backups [BACKUP_KEEP_DAYS=30] scripts/backup.sh
# Writes boq-<UTC time>.sql.gz, boq-<UTC time>-attachments.tar.gz and a SHA-256 manifest.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
: "${ATTACHMENTS_DIR:?set ATTACHMENTS_DIR}" "${BACKUP_DIR:?set BACKUP_DIR}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="$BACKUP_DIR/boq-$stamp"
umask 077
mkdir -p "$BACKUP_DIR"

log "dumping database $DB_NAME"
# One consistent snapshot (InnoDB), with the audit-log triggers.
dump --single-transaction --quick --routines --triggers --events --hex-blob "$DB_NAME" | gzip -9 > "$base.sql.gz"

log "archiving attachments from $ATTACHMENTS_DIR"
mkdir -p "$ATTACHMENTS_DIR"
tar -C "$ATTACHMENTS_DIR" -czf "$base-attachments.tar.gz" .

(cd "$BACKUP_DIR" && sha256sum "boq-$stamp.sql.gz" "boq-$stamp-attachments.tar.gz" > "boq-$stamp.sha256")
log "wrote $base.sql.gz, $base-attachments.tar.gz, $base.sha256"

if [ -n "${BACKUP_KEEP_DAYS:-}" ]; then
  find "$BACKUP_DIR" -name 'boq-*' -type f -mtime +"$BACKUP_KEEP_DAYS" -print -delete
fi
echo "$base"
