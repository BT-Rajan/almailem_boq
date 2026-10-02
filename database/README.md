# database

MariaDB 10.11+ only (InnoDB, utf8mb4). Plain SQL, no ORM.

```
database/
  migrations/   NNNN_name.up.sql + NNNN_name.down.sql   (one concern per migration)
  seed/         access.json  (roles, permissions, role mapping; no cost heads, no users)
```

The runner, seed loader and repositories live in `backend/src/db` and `backend/src/repositories`.

## Commands (from `backend/`, with `DATABASE_URL` set)

| Command                    | What it does                                              |
| -------------------------- | --------------------------------------------------------- |
| `pnpm db:migrate`          | Apply pending migrations                                  |
| `pnpm db:status`           | Show applied / pending                                    |
| `pnpm db:rollback`         | Roll back the newest migration (`pnpm db:rollback 2`, `pnpm db:rollback all`) |
| `pnpm db:seed`             | Load roles/permissions. Idempotent and additive           |
| `printf '%s' "$PW" \| pnpm admin:bootstrap <email> "<name>"` | Create the first administrator (password on stdin). Refused once one exists |

## Local setup

```sql
CREATE DATABASE boq CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'boq'@'127.0.0.1' IDENTIFIED BY 'change-me';
GRANT ALL ON boq.* TO 'boq'@'127.0.0.1';
```

## Tests

DB tests run against a real MariaDB. Set `TEST_DATABASE_URL` to a server URL with no database name,
for a user allowed to create databases named `boq_t_*`:

```sql
GRANT ALL ON `boq\_t%`.* TO 'boq'@'127.0.0.1';
```

Each test suite creates and drops its own database. Without `TEST_DATABASE_URL` those suites are skipped;
CI must set `REQUIRE_DB_TESTS=1` so a missing database fails the run instead of skipping.

## Rules to keep

- Never edit a migration after it is applied (the runner stores a checksum and refuses). Add a new one.
- MariaDB DDL is not transactional. Keep migrations small and write every `down` with `IF EXISTS`.
- `audit_log` rejects UPDATE and DELETE through triggers. In production the application's database user
  should not have `DROP`, `TRUNCATE` or `TRIGGER` privileges, otherwise those protections can be bypassed.
