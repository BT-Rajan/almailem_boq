#!/usr/bin/env bash
# installer.sh — the ONE command that sets up Almailem BoQ Manager and runs it under pm2.
#
#   bash installer.sh
#
# First run on a fresh server: installs what is missing (git, curl, Node.js, pnpm, pm2, MariaDB),
# creates the database and its accounts, builds the app, migrates, creates the first
# administrator, starts backend + frontend in pm2 and checks they answer.
# Later runs: pull the latest code, rebuild, migrate, restart. Every step checks before it changes
# anything, so re-running is safe. Passwords are never hard-coded and never rotated on a re-run.
#
# Env overrides (all optional; asked for on an interactive terminal, defaults otherwise):
#   APP_DIR REPO_URL BRANCH            where the code lives / comes from (default: this checkout)
#   DB_HOST DB_PORT DB_NAME            MariaDB (default 127.0.0.1:3306, database "boq")
#   DB_USER DB_PASS                    the app's account: data only (default boq_app, generated)
#   DB_ADMIN_USER DB_ADMIN_PASS        migrations/backups account (default boq_admin, generated)
#   MYSQL_ROOT_PASSWORD                if root@localhost needs a password (Debian/Ubuntu: sudo is enough)
#   PORT FRONTEND_PORT                 backend (default 3100, bound to 127.0.0.1) / web (default 7180)
#   HOST                               web server bind address (default 0.0.0.0)
#   PUBLIC_URL                         how browsers reach it, e.g. http://192.168.1.20:7180 or
#                                      https://boq.example.com (default http://localhost:FRONTEND_PORT)
#   ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD   first administrator (only when there are no users yet)
#   APP_NAME                           pm2 name prefix (default boq -> boq-api, boq-web)
#   HEALTH_TIMEOUT                     seconds to wait for the app (default 60)
#   NONINTERACTIVE=1                   never prompt; use defaults and generated passwords
#   SKIP_PULL=1                        don't git pull (deploy the checkout exactly as it is)
set -Eeuo pipefail

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
info() { printf '\033[1;34m  i %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m  ✘ %s\033[0m\n' "$*" >&2; exit 1; }
trap 'die "Failed at line $LINENO: $BASH_COMMAND"' ERR
have() { command -v "$1" >/dev/null 2>&1; }
is_tty() { [ "${NONINTERACTIVE:-0}" != "1" ] && [ -t 0 ]; }
ask() { # ask "prompt" default
  local reply
  if is_tty; then read -rp "  $1 [$2]: " reply || true; printf '%s\n' "${reply:-$2}"; else printf '%s\n' "$2"; fi
}
ask_secret() { # ask_secret "prompt" -> value (blank = generate)
  local reply=""
  if is_tty; then read -rsp "  $1 (leave blank to generate): " reply || true; printf '\n' >&2; fi
  printf '%s\n' "$reply"
}
gen_pass() { openssl rand -hex 16 2>/dev/null || head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
valid_ident() { [[ "$1" =~ ^[A-Za-z0-9_]+$ ]]; }
is_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }
sql_str() { local s="${1//\\/\\\\}"; printf '%s' "${s//\'/\\\'}"; }
urlenc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

REPO_URL="${REPO_URL:-https://github.com/BT-Rajan/almailem_boq.git}"
APP_NAME="${APP_NAME:-boq}"
API_APP="${APP_NAME}-api"
WEB_APP="${APP_NAME}-web"
HOST="${HOST:-0.0.0.0}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
NODE_MIN=20.19   # the oldest Node.js the app runs on (Vite sets this floor); any newer one is used as is
NODE_MAJOR=22    # what is installed when there is no Node.js at all
MIN_MARIADB=10.11

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "${APP_DIR:-}" ]; then
  if git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    APP_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
  else
    APP_DIR="$SCRIPT_DIR/almailem_boq"
  fi
fi
# Installer state (ports, accounts, passwords): kept out of git, readable by this user only.
STATE="$APP_DIR/.install.env"
state_get() { [ -f "$STATE" ] && grep -m1 "^$1=" "$STATE" | cut -d= -f2- || true; }

# ───────────────────────── 1. system packages ─────────────────────────
step "1/12 System packages"
if [ "$(id -u)" = "0" ]; then SUDO=""; elif have sudo; then SUDO="sudo"; else SUDO=""; fi
APT=0; have apt-get && APT=1
apt_install() {
  [ "$APT" = 1 ] || { warn "Cannot install $* automatically (no apt-get)"; return 1; }
  [ -n "$SUDO" ] || [ "$(id -u)" = 0 ] || { warn "Cannot install $*: need root or sudo"; return 1; }
  $SUDO apt-get update -qq && $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
}
for tool in git curl openssl; do
  have "$tool" || { warn "$tool missing — installing"; apt_install "$tool" || die "$tool is required"; }
done
ok "git, curl, openssl"

# ───────────────────────── 2. Node.js, pnpm, pm2 ─────────────────────────
step "2/12 Node.js, pnpm, pm2"
if ! have node; then
  warn "Node.js missing — installing ${NODE_MAJOR}.x from NodeSource"
  [ "$APT" = 1 ] || die "Install Node.js ${NODE_MAJOR} yourself (e.g. nvm) and re-run"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO bash - >/dev/null
  apt_install nodejs || die "Node.js install failed"
fi
# The Node.js already on the server is kept if it is new enough: other apps may depend on it.
node -e 'const [a,b]=process.argv[1].split(".").map(Number),[x,y]=process.versions.node.split(".").map(Number);process.exit(x>a||(x===a&&y>=b)?0:1)' "$NODE_MIN" \
  || die "Node $(node -v) found; this app needs Node ${NODE_MIN} or newer. Upgrade it (nvm or NodeSource) — not done automatically in case other apps use it."
PNPM_VERSION="$(node -p 'require(process.argv[1]).packageManager.split("@")[1]' "$APP_DIR/package.json" 2>/dev/null || echo 12.8.1)"
if ! have pnpm || [ "$(pnpm -v 2>/dev/null)" != "$PNPM_VERSION" ]; then
  info "Setting up pnpm $PNPM_VERSION"
  { $SUDO corepack enable >/dev/null 2>&1 && corepack prepare "pnpm@$PNPM_VERSION" --activate >/dev/null 2>&1; } \
    || $SUDO npm install -g "pnpm@$PNPM_VERSION" >/dev/null
fi
have pm2 || { warn "pm2 missing — installing"; $SUDO npm install -g pm2 >/dev/null; }
PM2_V="$(pm2 -v 2>/dev/null | tail -1)" # the first call starts the daemon and prints a banner
ok "node $(node -v), pnpm $(pnpm -v), pm2 $PM2_V"

# ───────────────────────── 3. code ─────────────────────────
step "3/12 Code"
if [ -e "$APP_DIR/.git" ]; then  # a directory, or a file in a git worktree
  cd "$APP_DIR"
  BRANCH="${BRANCH:-$(git branch --show-current)}"
  if [ "${SKIP_PULL:-0}" = "1" ]; then
    info "SKIP_PULL=1 — deploying the checkout as it is"
  else
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
      warn "Local changes found — stashing them (recover with: git stash list)"
      git stash push -m "installer.sh $(date +%Y%m%d-%H%M%S)" >/dev/null
    fi
    git fetch --prune origin "$BRANCH"
    git checkout "$BRANCH" >/dev/null 2>&1
    git pull --ff-only origin "$BRANCH"
  fi
else
  BRANCH="${BRANCH:-main}"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi
ok "$BRANCH @ $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
touch "$STATE"; chmod 600 "$STATE"

# ───────────────────────── 4. MariaDB server ─────────────────────────
step "4/12 MariaDB server"
DB_HOST="${DB_HOST:-$(state_get DB_HOST)}"; DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-$(state_get DB_PORT)}"; DB_PORT="${DB_PORT:-3306}"
if ! have mariadb && ! have mysql; then
  warn "MariaDB missing — installing mariadb-server"
  apt_install mariadb-server mariadb-client || die "MariaDB install failed — install MariaDB ${MIN_MARIADB}+ yourself and re-run"
fi
MYSQL="$(command -v mariadb || command -v mysql)"
reachable() {
  # A refused login proves the server is up. Capture first: under pipefail, piping the (expected)
  # failing client into grep would report "down" even when grep matched.
  local out
  out="$("$MYSQL" -h "$DB_HOST" -P "$DB_PORT" --connect-timeout=3 -u installer_probe -e 'SELECT 1' 2>&1 || true)"
  [[ "$out" =~ Access\ denied|1045|1698 ]] \
    || "$MYSQL" -h "$DB_HOST" -P "$DB_PORT" --connect-timeout=3 -e 'SELECT 1' >/dev/null 2>&1
}
if ! reachable && { [ "$DB_HOST" = 127.0.0.1 ] || [ "$DB_HOST" = localhost ]; }; then
  warn "MariaDB not answering — starting it"
  # systemd only when it is really the init system (not in many containers or WSL); else SysV.
  if [ -d /run/systemd/system ] && have systemctl; then
    $SUDO systemctl enable --now mariadb >/dev/null 2>&1 || true
  fi
  if ! reachable && have service; then
    $SUDO service mariadb start >/dev/null 2>&1 || $SUDO service mysql start >/dev/null 2>&1 || true
  fi
fi
for _ in 1 2 3 4 5 6 7 8 9 10; do reachable && break; sleep 2; done
reachable || die "Cannot reach MariaDB at $DB_HOST:$DB_PORT — start it and re-run"
# Version of a local server binary; a remote server is checked by the migrations themselves.
SRV=""
SERVER_BIN="$(command -v mariadbd || command -v mysqld || true)"
[ -n "$SERVER_BIN" ] && SRV="$("$SERVER_BIN" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
if [ -n "$SRV" ]; then
  version_ge "$SRV" "$MIN_MARIADB" || die "MariaDB $SRV is too old; this app needs ${MIN_MARIADB}+ (native UUID columns)"
  ok "MariaDB $SRV at $DB_HOST:$DB_PORT"
else
  ok "MariaDB reachable at $DB_HOST:$DB_PORT (version checked when migrating)"
fi

# ───────────────────────── 5. database and accounts ─────────────────────────
step "5/12 Database and accounts"
pick_ident() { # pick_ident VAR "prompt" default
  local v; v="${!1:-$(state_get "$1")}"; v="${v:-$(ask "$2" "$3")}"
  valid_ident "$v" || die "$1 must contain only letters, digits and _ (got '$v')"
  printf -v "$1" '%s' "$v"
}
pick_ident DB_NAME "Database name" boq
pick_ident DB_USER "App database account (data only)" boq_app
pick_ident DB_ADMIN_USER "Admin database account (migrations, backups)" boq_admin
DB_PASS="${DB_PASS:-$(state_get DB_PASS)}"
DB_ADMIN_PASS="${DB_ADMIN_PASS:-$(state_get DB_ADMIN_PASS)}"
[ -n "$DB_PASS" ] || DB_PASS="$(ask_secret "Password for $DB_USER")"
[ -n "$DB_PASS" ] || DB_PASS="$(gen_pass)"
[ -n "$DB_ADMIN_PASS" ] || DB_ADMIN_PASS="$(ask_secret "Password for $DB_ADMIN_USER")"
[ -n "$DB_ADMIN_PASS" ] || DB_ADMIN_PASS="$(gen_pass)"

can_login() { MYSQL_PWD="$2" "$MYSQL" -h "$DB_HOST" -P "$DB_PORT" -u "$1" --connect-timeout=5 -e "USE \`$DB_NAME\`" >/dev/null 2>&1; }
can_auth() { MYSQL_PWD="$2" "$MYSQL" -h "$DB_HOST" -P "$DB_PORT" -u "$1" --connect-timeout=5 -e "SELECT 1" >/dev/null 2>&1; }
ROOT_ERR=""
as_root() { # prints the query's rows (no headers) on success
  local out
  if [ -z "${MYSQL_ROOT_PASSWORD:-}" ] && { [ -n "$SUDO" ] || [ "$(id -u)" = 0 ]; }; then
    out="$($SUDO "$MYSQL" -N -B -e "$1" 2>&1)" && { printf '%s' "$out"; return 0; }; ROOT_ERR="$out"
  fi
  if [ -n "${MYSQL_ROOT_PASSWORD:-}" ]; then
    out="$(MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$MYSQL" -h "$DB_HOST" -P "$DB_PORT" -u root -N -B -e "$1" 2>&1)" && { printf '%s' "$out"; return 0; }; ROOT_ERR="$out"
  fi
  return 1
}
# An account that already exists (perhaps used by another install) keeps its password: we only
# use it if the password we have works, and never change it.
check_existing_account() { # check_existing_account USER PASSWORD VAR_NAME
  local n
  n="$(as_root "SELECT COUNT(*) FROM mysql.user WHERE User = '$(sql_str "$1")'")" \
    || die "Could not administer MariaDB as root: ${ROOT_ERR:-no root access}. Run with sudo, or set MYSQL_ROOT_PASSWORD."
  [ "$n" = 0 ] || can_auth "$1" "$2" \
    || die "Database account '$1' already exists with a different password, and this installer never changes it. Re-run with its password ($3=...), or pick a new account name (${3%_PASS}_USER=...)."
}
if can_login "$DB_USER" "$DB_PASS" && can_login "$DB_ADMIN_USER" "$DB_ADMIN_PASS"; then
  ok "Database '$DB_NAME' and both accounts already work — reusing them"
else
  info "Creating database '$DB_NAME' and any missing accounts ('$DB_USER', '$DB_ADMIN_USER')"
  check_existing_account "$DB_USER" "$DB_PASS" DB_PASS
  check_existing_account "$DB_ADMIN_USER" "$DB_ADMIN_PASS" DB_ADMIN_PASS
  P="$(sql_str "$DB_PASS")"; A="$(sql_str "$DB_ADMIN_PASS")"
  SQL="CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  for h in localhost 127.0.0.1; do
    SQL+="
      CREATE USER IF NOT EXISTS '$DB_USER'@'$h' IDENTIFIED BY '$P';
      CREATE USER IF NOT EXISTS '$DB_ADMIN_USER'@'$h' IDENTIFIED BY '$A';
      GRANT SELECT, INSERT, UPDATE, DELETE ON \`$DB_NAME\`.* TO '$DB_USER'@'$h';
      GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_ADMIN_USER'@'$h';
      GRANT ALL PRIVILEGES ON \`${DB_NAME}_restore_check\`.* TO '$DB_ADMIN_USER'@'$h';"
  done
  SQL+=" FLUSH PRIVILEGES;"
  as_root "$SQL" >/dev/null || die "Could not administer MariaDB as root: ${ROOT_ERR:-no root access}. Run with sudo, or set MYSQL_ROOT_PASSWORD."
  can_login "$DB_USER" "$DB_PASS" && can_login "$DB_ADMIN_USER" "$DB_ADMIN_PASS" \
    || die "Accounts created but cannot log in — check DB_HOST/DB_PORT"
  ok "Database '$DB_NAME' ready; '$DB_USER' may only read and write data, '$DB_ADMIN_USER' runs migrations"
fi

# ───────────────────────── 6. ports and address ─────────────────────────
step "6/12 Ports and address"
pm2_has() { pm2 describe "$1" >/dev/null 2>&1; }
port_free() {
  if have ss; then ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[.:]$1\$"
  else ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; fi
}
pick_port() { # pick_port VAR "prompt" default owner-pm2-app
  local p; p="${!1:-$(state_get "$1")}"; p="${p:-$(ask "$2" "$3")}"
  is_port "$p" || die "$1 must be a port number (got '$p')"
  if ! port_free "$p" && ! pm2_has "$4"; then
    is_tty || die "Port $p is in use — set $1 to a free port"
    while ! port_free "$p"; do warn "Port $p is in use"; p="$(ask "$2" "$((p + 1))")"; is_port "$p" || die "bad port"; done
  fi
  printf -v "$1" '%s' "$p"
}
pick_port PORT "Backend port (local only)" 3100 "$API_APP"
pick_port FRONTEND_PORT "Web port" 7180 "$WEB_APP"
[ "$PORT" != "$FRONTEND_PORT" ] || die "PORT and FRONTEND_PORT must differ"
PUBLIC_URL="${PUBLIC_URL:-$(state_get PUBLIC_URL)}"
PUBLIC_URL="${PUBLIC_URL:-$(ask "Address people will open in the browser" "http://localhost:$FRONTEND_PORT")}"
PUBLIC_URL="${PUBLIC_URL%/}"
[[ "$PUBLIC_URL" =~ ^https?://[^/]+$ ]] || die "PUBLIC_URL must look like http://host:port or https://host (got '$PUBLIC_URL')"
PUBLIC_HOST="$(node -p 'new URL(process.argv[1]).hostname' "$PUBLIC_URL")"
case "$PUBLIC_URL" in
  https://*) COOKIE_SECURE=true ;;
  *) COOKIE_SECURE=false
     [ "$PUBLIC_HOST" = localhost ] || warn "Plain http: sessions travel unencrypted on the network. Put it behind https for real use (DEPLOY.md)." ;;
esac
ok "Backend 127.0.0.1:$PORT, web $HOST:$FRONTEND_PORT, opened as $PUBLIC_URL"

# ───────────────────────── 7. configuration ─────────────────────────
step "7/12 Configuration"
{
  echo "# Written by installer.sh. Holds passwords: keep private (chmod 600), never commit."
  for k in DB_HOST DB_PORT DB_NAME DB_USER DB_PASS DB_ADMIN_USER DB_ADMIN_PASS PORT FRONTEND_PORT PUBLIC_URL; do
    printf '%s=%s\n' "$k" "${!k}"
  done
} > "$STATE"
chmod 600 "$STATE"
ENV="$APP_DIR/backend/.env"
touch "$ENV"; chmod 600 "$ENV"
set_env() { # set_env KEY VALUE: replace or append, leaving every other line alone
  local tmp; tmp="$(mktemp)"
  grep -v "^$1=" "$ENV" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV"; rm -f "$tmp"
}
ORIGINS="$PUBLIC_URL"
for o in "http://localhost:$FRONTEND_PORT" "http://127.0.0.1:$FRONTEND_PORT"; do
  [ "$o" = "$PUBLIC_URL" ] || ORIGINS+=",$o"
done
set_env NODE_ENV production
set_env HOST 127.0.0.1
set_env PORT "$PORT"
grep -q '^LOG_LEVEL=.' "$ENV" || set_env LOG_LEVEL info  # keep a level someone chose
set_env DATABASE_URL "mysql://$DB_USER:$(urlenc "$DB_PASS")@$DB_HOST:$DB_PORT/$DB_NAME"
set_env CORS_ORIGINS "$ORIGINS"
set_env TRUST_PROXY loopback
set_env COOKIE_SECURE "$COOKIE_SECURE"
grep -q '^ATTACHMENTS_DIR=.' "$ENV" || set_env ATTACHMENTS_DIR "$APP_DIR/data/attachments"
mkdir -p "$(grep -m1 '^ATTACHMENTS_DIR=' "$ENV" | cut -d= -f2-)"
chmod 700 "$APP_DIR/data" "$(grep -m1 '^ATTACHMENTS_DIR=' "$ENV" | cut -d= -f2-)" 2>/dev/null || true
ADMIN_URL="mysql://$DB_ADMIN_USER:$(urlenc "$DB_ADMIN_PASS")@$DB_HOST:$DB_PORT/$DB_NAME"
ok "backend/.env and .install.env written (both chmod 600)"

# ───────────────────────── 8. dependencies and build ─────────────────────────
step "8/12 Install dependencies and build"
pnpm install --frozen-lockfile --reporter=silent
pnpm build >/dev/null
[ -f backend/dist/server.js ] && [ -f frontend/dist/index.html ] || die "Build did not produce backend/dist and frontend/dist"
ok "Built backend/dist and frontend/dist"

# ───────────────────────── 9. database schema ─────────────────────────
step "9/12 Database schema and reference data"
cd "$APP_DIR/backend"
# The admin account migrates; the app itself only ever uses the data-only account.
DATABASE_URL="$ADMIN_URL" pnpm --silent db:migrate | sed 's/^/  /'
DATABASE_URL="$ADMIN_URL" pnpm --silent db:seed | sed 's/^/  /'
PENDING="$(DATABASE_URL="$ADMIN_URL" pnpm --silent db:status | grep -c '^pending' || true)"
[ "$PENDING" = 0 ] || die "$PENDING migration(s) still pending"
ok "Schema up to date"

# ───────────────────────── 10. first administrator ─────────────────────────
step "10/12 First administrator"
USERS="$(MYSQL_PWD="$DB_PASS" "$MYSQL" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -N -e "SELECT COUNT(*) FROM \`$DB_NAME\`.users")"
if [ "$USERS" != 0 ]; then
  ok "$USERS user(s) already exist — sign in with an existing account"
else
  ADMIN_EMAIL="${ADMIN_EMAIL:-$(ask "Administrator email" "admin@example.com")}"
  ADMIN_NAME="${ADMIN_NAME:-$(ask "Administrator name" "Administrator")}"
  GENERATED_ADMIN=0
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    ADMIN_PASSWORD="$(ask_secret "Administrator password (12+ characters)")"
    [ -n "$ADMIN_PASSWORD" ] || { ADMIN_PASSWORD="$(gen_pass)"; GENERATED_ADMIN=1; }
  fi
  [ "${#ADMIN_PASSWORD}" -ge 12 ] || die "The administrator password must be at least 12 characters"
  printf '%s' "$ADMIN_PASSWORD" | DATABASE_URL="$ADMIN_URL" pnpm --silent admin:bootstrap "$ADMIN_EMAIL" "$ADMIN_NAME" | sed 's/^/  /'
  ok "Administrator $ADMIN_EMAIL created"
  [ "$GENERATED_ADMIN" = 1 ] && warn "Generated password for $ADMIN_EMAIL: $ADMIN_PASSWORD  (shown once — sign in and keep it safe)"
fi
cd "$APP_DIR"

# ───────────────────────── 11. pm2 ─────────────────────────
step "11/12 Start with pm2"
# One ecosystem file for both processes, regenerated every run (it holds local paths only; ignored by git).
ECOSYSTEM="$APP_DIR/ecosystem.config.json"
node - "$ECOSYSTEM" "$API_APP" "$WEB_APP" "$APP_DIR" "$HOST" "$FRONTEND_PORT" "$PORT" "$PUBLIC_HOST" <<'JS'
const [file, api, web, dir, host, webPort, apiPort, publicHost] = process.argv.slice(2);
const apps = [
  {
    name: api,
    cwd: `${dir}/backend`,
    script: 'dist/server.js', // reads backend/.env itself
    interpreter: 'node',
    autorestart: true,
    max_restarts: 10,
    exp_backoff_restart_delay: 200,
  },
  {
    name: web,
    cwd: `${dir}/frontend`,
    script: 'node_modules/vite/bin/vite.js',
    args: ['preview', '--host', host, '--port', webPort, '--strictPort'],
    interpreter: 'node',
    autorestart: true,
    env: { BOQ_API_URL: `http://127.0.0.1:${apiPort}`, BOQ_PUBLIC_HOST: publicHost },
  },
];
require('fs').writeFileSync(file, JSON.stringify({ apps }, null, 2));
JS
pm2 delete "$API_APP" >/dev/null 2>&1 || true
pm2 delete "$WEB_APP" >/dev/null 2>&1 || true
pm2 start "$ECOSYSTEM" >/dev/null
pm2 save --force >/dev/null
ok "pm2: $API_APP and $WEB_APP started and saved"

# ───────────────────────── 12. health checks ─────────────────────────
step "12/12 Health checks"
logs() { pm2 logs "$1" --lines 40 --nostream 2>&1 | tail -50 || true; }
wait_for() { # wait_for url pattern
  for ((i = 0; i < HEALTH_TIMEOUT; i += 2)); do
    curl -s -m 5 "$1" 2>/dev/null | grep -q "$2" && return 0
    sleep 2
  done
  return 1
}
wait_for "http://127.0.0.1:$PORT/api/ready" '"ready"' || { logs "$API_APP"; die "Backend not ready on :$PORT within ${HEALTH_TIMEOUT}s"; }
ok "Backend ready (database and file store OK)"
wait_for "http://127.0.0.1:$FRONTEND_PORT/" 'id="root"' || { logs "$WEB_APP"; die "Web app not answering on :$FRONTEND_PORT"; }
ok "Web app answering on :$FRONTEND_PORT"
wait_for "http://127.0.0.1:$FRONTEND_PORT/api/health" '"ok"' || { logs "$WEB_APP"; die "The web app cannot reach the backend through /api"; }
ok "Web app reaches the backend through /api"
for app in "$API_APP" "$WEB_APP"; do
  STATUS="$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s.slice(s.indexOf("["))).find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.status:"missing")})' "$app")"
  [ "$STATUS" = online ] || { logs "$app"; die "pm2 process $app is $STATUS"; }
done
ok "pm2 processes online"

printf '\n\033[1;32mAlmailem BoQ Manager is running\033[0m  (%s @ %s)\n' "$BRANCH" "$(git rev-parse --short HEAD)"
echo "  Open:          $PUBLIC_URL"
echo "  Manage:        pm2 status | pm2 logs $API_APP | pm2 restart $ECOSYSTEM"
echo "  Update later:  bash installer.sh     (pulls, rebuilds, migrates, restarts)"
echo "  Start on boot: pm2 startup           (once; run the command it prints)"
echo "  Backups:       see DEPLOY.md section 8 (database account and passwords are in .install.env)"
