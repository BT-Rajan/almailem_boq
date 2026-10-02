#!/usr/bin/env bash
# create-admin.sh — create the first administrator (the account you sign in to the app with).
#
#   bash create-admin.sh
#
# Asks for email, name and password (hidden, typed twice). The account is stored in the app's
# database through the connection in backend/.env, which installer.sh writes. Works only while no
# administrator exists; after that, add users in the app (Users).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/backend"
[ -f .env ] || { echo "backend/.env not found — run installer.sh first." >&2; exit 1; }
[ -t 0 ] || { echo "Run this in a terminal: it asks for the password." >&2; exit 1; }
exec pnpm --silent admin:bootstrap
