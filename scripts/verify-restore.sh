#!/usr/bin/env bash
# Prove a backup restores to a WORKING app: back up the live database and attachments, restore
# them into a scratch database and directory, then compare row counts and file checksums, check
# that no migration is pending, start the app on the restored copy and ask it real questions.
#   DB_USER=... DB_PASSWORD=... DB_NAME=boq ATTACHMENTS_DIR=... \
#   [VERIFY_EMAIL=... VERIFY_PASSWORD=...] scripts/verify-restore.sh
# Needs rights to create and drop a database named <DB_NAME>_restore_check.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
source "$here/lib.sh"
: "${ATTACHMENTS_DIR:?set ATTACHMENTS_DIR}"

work="$(mktemp -d)"
check_db="${DB_NAME}_restore_check"
port="${VERIFY_PORT:-3999}"
cleanup() {
  # The app runs in its own process group: end the whole group, not just the wrapper.
  [ -n "${app_pid:-}" ] && kill -- "-$app_pid" 2>/dev/null || true
  db -e "DROP DATABASE IF EXISTS \`$check_db\`" || true
  rm -rf "$work" "$DEFAULTS_FILE"
}
trap cleanup EXIT

base="$(BACKUP_DIR="$work/backups" "$here/backup.sh" | tail -1)"
db -e "DROP DATABASE IF EXISTS \`$check_db\`"
DB_NAME="$check_db" ATTACHMENTS_DIR="$work/attachments" "$here/restore.sh" "$base"

log "comparing row counts"
counts() {
  db -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema = '$1' ORDER BY table_name" |
    while read -r t; do printf '%s %s\n' "$t" "$(db -N -e "SELECT COUNT(*) FROM \`$1\`.\`$t\`")"; done
}
diff <(counts "$DB_NAME") <(counts "$check_db")
counts "$check_db" | sed 's/^/  /'

log "comparing attachment files"
diff <(cd "$ATTACHMENTS_DIR" && find . -type f -exec sha256sum {} + | sort) \
     <(cd "$work/attachments" && find . -type f -exec sha256sum {} + | sort)
echo "  $(find "$work/attachments" -type f | wc -l) files identical"

log "checking the audit log is still append-only"
if db "$check_db" -e "UPDATE audit_log SET event = event LIMIT 1" 2>/dev/null; then
  echo "restored audit_log accepted an UPDATE: its triggers are missing" >&2; exit 1
fi
echo "  UPDATE refused by trigger"

pass="${DB_PASSWORD:-}"
url="mysql://$DB_USER${pass:+:$pass}@$DB_HOST:$DB_PORT/$check_db"
log "checking migrations on the restored copy"
pending="$(cd "$root/backend" && DATABASE_URL="$url" npx tsx src/db/cli.ts status | grep -c '^pending' || true)"
if [ "$pending" != "0" ]; then echo "restored database has $pending pending migrations" >&2; exit 1; fi

log "starting the app on the restored copy (port $port)"
if curl -s -o /dev/null "http://127.0.0.1:$port/"; then
  echo "port $port is already in use; set VERIFY_PORT" >&2; exit 1
fi
setsid bash -c "cd '$root/backend' && DATABASE_URL='$url' ATTACHMENTS_DIR='$work/attachments' PORT='$port' LOG_LEVEL=warn exec npx tsx src/server.ts" \
  > "$work/app.log" 2>&1 &
app_pid=$!
for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$port/api/health" > /dev/null && break; sleep 0.5; done
curl -sf "http://127.0.0.1:$port/api/ready" | grep -q '"ready"' || { cat "$work/app.log"; echo "app not ready" >&2; exit 1; }
echo "  /api/ready: ready"

if [ -n "${VERIFY_EMAIL:-}" ]; then
  jar="$work/cookies"
  login="$(curl -sf -c "$jar" -H 'content-type: application/json' \
    -d "{\"email\":\"$VERIFY_EMAIL\",\"password\":\"$VERIFY_PASSWORD\"}" "http://127.0.0.1:$port/api/auth/login")"
  echo "$login" | grep -q '"ok":true' || { echo "login on the restored copy failed" >&2; exit 1; }
  dash="$(curl -sf -b "$jar" "http://127.0.0.1:$port/api/dashboard")"
  echo "  signed in; dashboard: $(echo "$dash" | grep -o '"projects":[0-9]*' | head -1)"
  first_bill="$(db -N -e "SELECT CONCAT(project_id, '/expenses/', id) FROM \`$check_db\`.expenses WHERE attachment_key IS NOT NULL LIMIT 1")"
  if [ -n "$first_bill" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "http://127.0.0.1:$port/api/projects/$first_bill/attachment")"
    echo "  a restored bill downloads: HTTP $code"
    [ "$code" = "200" ] || { cat "$work/app.log"; exit 1; }
  fi
fi
log "VERIFIED: the backup restores to a working app"
