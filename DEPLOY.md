# DEPLOY

How to run Almailem BoQ Manager in production: one Node.js API process behind a reverse proxy that also serves the built single-page app, and a MariaDB database.

## 0. One-command install (pm2)

On a single Ubuntu/Debian server, `installer.sh` does sections 1–5 for you and runs the app under pm2:

```sh
bash installer.sh                    # from a checkout; or copy installer.sh alone and set REPO_URL
pm2 startup                          # once, to start on boot (run the command it prints)
```

It installs what is missing (git, curl, Node.js, pnpm, pm2, MariaDB). An existing Node.js 20.19 or newer is used as is; Node.js 22 is installed only when there is none. It then:

- creates the database (`boq` by default) with the two accounts of section 2;
- writes `backend/.env`;
- builds the app;
- migrates and seeds the database;
- creates the first administrator, if there are no users;
- starts two pm2 processes:
  - `boq-api` on `127.0.0.1:3100`;
  - `boq-web`, which serves `frontend/dist` on port 7180 and proxies `/api` to the API;
- checks both are healthy.

It never asks anything. Each setting comes from the environment, else `.install.env` (what the last run used), else the default below; passwords that are not given are generated. `INTERACTIVE=1` makes it ask instead.

Settings and passwords are kept in `.install.env` (mode 600, ignored by git); never put them in the script, which is public. Run it again to update: it pulls, rebuilds, migrates and restarts, reusing every setting and password.

The database is created only if it does not exist; otherwise it is used as it is. A database account that already exists keeps its password: give that password on the first run, for example `DB_PASS='…' bash installer.sh`, and it is remembered after that.

| Override | Default |
|---|---|
| `DB_NAME`, `DB_USER` | `boq`, `app_user` |
| `DB_ADMIN_USER` | `<DB_USER>_admin`. Set it equal to `DB_USER` for a single account, which makes the audit log less protected (HARDENING A3). |
| `DB_HOST`, `DB_PORT` | `127.0.0.1`, `3306` |
| `DB_PASS`, `DB_ADMIN_PASS` | Generated (an existing account needs its password given once) |
| `MYSQL_ROOT_PASSWORD` | Unset (root through the unix socket) |
| `PORT`, `FRONTEND_PORT` | `3100`, `7180` |
| `PUBLIC_URL` | `http://<server IP>:7180`. Sign-in also works from the server's other addresses on that port. |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | `admin@almailem.local`, `Administrator`, generated. The generated login is printed at the end and saved in `.install.env`. |
| `BRANCH`, `REPO_URL`, `SKIP_PULL=1` | The current branch. `SKIP_PULL=1` deploys the checkout as it is. |

For use beyond a single machine, put https in front: set `PUBLIC_URL=https://…` (this turns on `Secure` cookies) and point the TLS proxy at port 7180. Alternatively, use the nginx setup of sections 6–7 instead of `boq-web`.

## 1. What you need

- **Node.js 20.19 or newer** (22 recommended) and **pnpm** (version from `package.json`, via `corepack enable`).
- **MariaDB 10.11 or newer.**
- **A reverse proxy** with TLS. The example below is nginx.
- **Two persistent directories:** attachments, and backups (on a different disk or volume).

## 2. Database

```sql
CREATE DATABASE boq CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The app's own account: data only. No DROP, ALTER, TRIGGER or GRANT, so the audit
-- triggers and the schema cannot be changed through it.
CREATE USER 'boq_app'@'10.0.0.%' IDENTIFIED BY '<long random password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON boq.* TO 'boq_app'@'10.0.0.%';

-- Migrations, backups and restores use a separate admin account.
CREATE USER 'boq_admin'@'10.0.0.%' IDENTIFIED BY '<another long random password>';
GRANT ALL ON boq.* TO 'boq_admin'@'10.0.0.%';
GRANT ALL ON `boq\_restore\_check`.* TO 'boq_admin'@'10.0.0.%';  -- for scripts/verify-restore.sh
```

## 3. Build

```sh
pnpm install --frozen-lockfile
pnpm lint && pnpm test && pnpm build      # tests need TEST_DATABASE_URL (database/README.md)
```

- **API:** `backend/dist/server.js`, a single bundled file.
- **App:** `frontend/dist/`, static files.

## 4. Configuration (environment of the API process)

Every value is checked at start. A bad value stops the process with the key's name, never its value. See `.env.example`.

| Key | Production value |
|---|---|
| `NODE_ENV` | `production`. This enables `Secure` `__Host-` cookies and HSTS. |
| `HOST`, `PORT` | `127.0.0.1`, `3000` (only the proxy talks to it) |
| `DATABASE_URL` | `mysql://boq_app:<password>@<db host>:3306/boq` |
| `CORS_ORIGINS` | The app's public origin, e.g. `https://boq.almailem.example` |
| `TRUST_PROXY` | `true`, because the proxy below sets `X-Forwarded-For` (`loopback` trusts only a proxy on the same machine; the installer uses it) |
| `COOKIE_SECURE` | `auto` (on in production). `false` only for a plain-http install, which the installer sets when `PUBLIC_URL` is `http://` |
| `ATTACHMENTS_DIR` | e.g. `/srv/boq/attachments`. Persistent, owned by the service user, mode 700, **not** inside any directory the web server serves |
| `ATTACHMENT_MAX_MB`, `ATTACHMENT_UPLOADS_PER_HOUR` | 10 and 120 unless there is a reason |
| `SESSION_*`, `LOGIN_*` | Defaults (DECISIONS D15) |
| `LOG_LEVEL` | `info` |

Keep secrets in the service manager's environment file (mode 600), never in the repository.

## 5. First install

```sh
cd backend
DATABASE_URL=mysql://boq_admin:<password>@host/boq pnpm db:migrate
DATABASE_URL=mysql://boq_admin:<password>@host/boq pnpm db:seed          # roles, permissions, cost heads
printf '%s' "$FIRST_ADMIN_PASSWORD" | DATABASE_URL=... pnpm admin:bootstrap admin@almailem.example "Name"
```

## 6. Run the API (systemd)

```ini
# /etc/systemd/system/boq.service
[Unit]
Description=Almailem BoQ Manager API
After=network-online.target

[Service]
User=boq
WorkingDirectory=/srv/boq/app/backend
EnvironmentFile=/etc/boq/boq.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/boq/attachments
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

- **On an unexpected error** the process reports it and exits; systemd restarts it.
- **Health checks:**
  - `GET /api/health` is liveness.
  - `GET /api/ready` is readiness: the database answers and the attachment store is writable. It returns 503 otherwise and never says why.

## 7. Reverse proxy (nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name boq.almailem.example;
  # ssl_certificate ...; ssl_certificate_key ...;

  # The app: static files only. Strict policy, checked against the production build with no violations.
  root /srv/boq/app/frontend/dist;
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
  add_header Permissions-Policy "camera=(self), microphone=(), geolocation=()" always;
  location / { try_files $uri /index.html; }
  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }

  # The API (it sets its own security headers).
  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # replace, never append, the client's value
    proxy_set_header X-Forwarded-Proto https;
    client_max_body_size 11m;                      # ATTACHMENT_MAX_MB plus headroom
  }
}
server { listen 80; server_name boq.almailem.example; return 301 https://$host$request_uri; }
```

`camera=(self)` lets the iPad's "Take photo" input use the camera; the API itself denies the camera.

## 8. Backups

- **Nightly**, as the admin database user:

  ```sh
  DB_USER=boq_admin DB_PASSWORD=... DB_NAME=boq ATTACHMENTS_DIR=/srv/boq/attachments \
  BACKUP_DIR=/srv/boq/backups BACKUP_KEEP_DAYS=30 scripts/backup.sh
  ```

  It writes one consistent database dump (with the audit-log triggers), an archive of the bills, and a SHA-256 manifest. Copy them off the server.
- **Weekly**, prove the latest backup restores to a working app:

  ```sh
  DB_USER=boq_admin DB_PASSWORD=... DB_NAME=boq ATTACHMENTS_DIR=/srv/boq/attachments \
  VERIFY_EMAIL=<a real account> VERIFY_PASSWORD=... scripts/verify-restore.sh
  ```

  It restores into a scratch database and directory and checks:
  - row counts and file checksums;
  - that the audit log is still append-only;
  - that no migration is pending;
  - that the app starts, is ready, signs in, shows the dashboard and serves a bill.
- **Real restore** (into an empty database and directory): `scripts/restore.sh <backup path without extension>`, then point the service at them.

## 9. Migration runbook (every upgrade)

1. Read the new migrations in `database/migrations/` and the release's DECISIONS entries.
2. **Back up first** (section 8). Migrations are not transactional in MariaDB (D13).
3. Stop the API: `systemctl stop boq`.
4. `pnpm db:status` (admin account), then `pnpm db:migrate`. The runner applies migrations in order, records each one only after it succeeds, and refuses to run if an applied migration file was changed.
5. `pnpm db:seed` if `database/seed/` changed. It only adds, never removes.
6. Deploy the new `backend/dist` and `frontend/dist`, then `systemctl start boq`.
7. Wait for `GET /api/ready` to return 200, then sign in and open a project.
8. **If something fails:**
   - `pnpm db:rollback` undoes the newest migration (`db:rollback 2` for two); each has a `down` file.
   - If a migration failed halfway, restore the backup from step 2 instead.

## 10. Error monitoring

- **Unexpected errors** are logged as structured JSON (`level` 50/60) with the route pattern, never request bodies, cookies or tokens.
- **To forward them** to Sentry or a webhook, register a reporter at start-up:

  ```ts
  import { addErrorReporter } from './errors/monitoring';
  addErrorReporter((err, ctx) => Sentry.captureException(err, { tags: ctx }));
  ```

  A reporter that fails never affects the request.
- **Alert on:**
  - any `level >= 50` log line;
  - `/api/ready` returning 503;
  - repeated `auth.account_locked` events in the audit log.
