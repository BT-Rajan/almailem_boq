# DECISIONS

Status: D1 stack **ACCEPTED** ("go ahead", Chunk 01 built on it). Other items as marked. Updated after domain Q&A and Chunk 01.

## D1. Stack (proposed)
| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) end to end | One type system for shared schemas (rule 4); matches the draft plan |
| Backend | Node.js + Fastify | Small, fast, schema-first validation, low ceremony for a ~35K LOC target |
| Validation | Zod, defined in `shared/` | One schema used by API and UI (rules 4, 7) |
| Database | **MariaDB** (InnoDB, utf8mb4), 10.11 LTS or newer. MariaDB only; no other database engine | Org standard. Row locks (`SELECT ... FOR UPDATE`) and transactions for approvals (Chunk 10, 18), exact `BIGINT` money, FK and unique constraints |
| DB access | Plain SQL via `mysql2` (promise API, prepared statements) with a thin repository layer and SQL migrations | Parameterised only (rule 8), no ORM magic, easy EXPLAIN tuning |
| Frontend | React + Vite, TanStack Query and Table | Dense tables and bottom sheets for iPad; no logic in components |
| Tests | Vitest, plus Playwright for iPad viewport checks | Covers Chunks 1, 17, 18 |
| Package manager | pnpm workspaces (`frontend`, `backend`, `shared`) | Single install, shared package |

Repo was empty at Chunk 00, so there was no existing convention to follow. Accepted and built in Chunk 01. Resolved versions: Node 22, pnpm 12, TypeScript 5.9 (pinned, one version repo-wide), Fastify 5, Vite 7, React 19, Vitest 3, Zod 3.

## D2. Money
Integer fils (1 KWD = 1000 fils), stored as `BIGINT`, handled in the app as `bigint`/safe integers. Never floats. Formatting to `KWD 1,234.567` happens once, at the UI edge, through the shared money helper. Multi-currency is out of scope for V1 unless the workbook shows otherwise (see Q3).

## D3. Utilisation and thresholds
Zero budget with any spend counts as 100% utilisation, so it is APPROVAL_REQUIRED (confirmed). Utilisation is compared with exact integer maths (`actual * 10000 / budget` in basis points), not floats, so 79.99 / 80.00 / 99.99 / 100.00 boundaries are exact. Thresholds (80% and 100%) live in one config row, editable in Admin > Approval Rules, read only by `domain/control`.

## D4. Soft delete
`deleted_at` only on `users`, `projects`, `cost_heads`. Expenses are never deleted: a reversal is a negative entry linked to the original. Audit rows are append-only. Cost heads referenced by an estimate or expense can be deactivated, never removed.

## D5. Auth
Server-side sessions in an HttpOnly, Secure, SameSite=Lax cookie, with CSRF protection, argon2id password hashing, failed-login lockout. Chosen over JWT because revoking a disabled user's access must take effect on the next request (Chunk 04). No SSO in V1.

## D6. Authorization
Permission-based. Roles (Admin, Project Manager, Accountant, Viewer) are just bundles of permissions. Code checks `authorize(permission)` and `authorizeProjectAccess(projectId)` only; role names are never compared.

## D6a. Flat organisation (confirmed)
V1 treats the organisation as flat: all active users get the same working permissions on projects they are members of. The permission-based `authorize()` structure from D6 stays in place so RBAC can be tightened later without touching routes. Open point for Chunk 10: approvals still need someone who can decide and who is not the requester; proposal is that any user with `approval.decide` (granted to all in V1) other than the requester may approve.

## D7. Deferred / left out of V1
- Committed amount (no PO module yet).
- Multi-level approval chains, email/push notifications, custom role editor, SSO.
- Charts, saved searches, scheduled imports.

## D8. Workbook as source and template (confirmed)
The workbook is a template reused across projects. It is the source for cost-head seed data (a file in `database/seed/`, never in code). The importer reads columns A-F only, cached values only, and ignores scratch cells to the right (see DOMAIN 6.5). The cost-head level (24 divisions vs 83 coded rows) is open: DOMAIN Q9.

## D9. Money representation in code (Chunk 01)
`Fils` is a branded safe-integer `number` (max about 9 trillion KWD, ample). It is `BIGINT` only in MariaDB; repositories convert at the boundary and reject values beyond the safe range. All construction goes through `fils()` / `kdToFils()`, all display through `formatFils()` in `shared/money.ts`. Display format is Kuwait style `NNN,NNN.NNN` (confirmed): thousands separators, always 3 decimals. Parsing more than 3 decimals rounds half away from zero.

## D10. Workbook is a guide, not the source of truth (confirmed)
The 24-division sample is illustrative. The real list is **32 cost heads, to be supplied**. Cost-head level (DOMAIN Q9) and code-prefix fixes (Q11) are deferred until then. Chunk 05 must not seed from the workbook.

## D11. Warnings go to all project members (confirmed)
The 80% warning (Chunk 11) is sent to every member of the project.

## D12. Repo conventions (Chunk 01)
`@boq/shared` ships as TypeScript source and is bundled into the backend by tsup and compiled by Vite for the frontend, so there is no separate build order. Dependency install scripts are blocked except `esbuild` (`allowBuilds` in `pnpm-workspace.yaml`). Env values are validated once at startup; error text names the key and the kind of problem, never the value.

## D13. Database is MariaDB only (corrected in Chunk 02)
The draft stack named PostgreSQL by mistake. Everything targets MariaDB 10.11+ (InnoDB, `utf8mb4`). Consequences, all handled in Chunk 02:
- **DDL is not transactional in MariaDB.** A migration that fails halfway cannot roll back by itself. Migrations are therefore small (one concern each), each has a matching `down`, and the runner records a migration only after it fully succeeds.
- **IDs:** native `UUID` columns with `DEFAULT UUID()`. MariaDB stores them index-friendly, so no UUIDv7 library is needed.
- **Case:** columns use `utf8mb4_unicode_ci`, so `Ali@x.com` and `ali@x.com` are the same email for uniqueness.
- **No partial indexes**, so uniqueness on soft-deletable tables (user email, project code, cost-head code) applies across live and deleted rows. A deleted user's email cannot be reused; restore the user instead.
- **JSON** columns are `JSON` (an alias of `LONGTEXT` with a validity check); reads parse in the repository.
- **Append-only audit** is enforced in the database with triggers that reject `UPDATE` and `DELETE`, not only by repository convention.
- **Tests run against a real MariaDB** via `TEST_DATABASE_URL`; constraint behaviour is not simulated.

## D14. Chunk 02 schema choices (review these)
- **Link tables and audit_log have `created_at` only**, no `updated_at`: their rows are never edited (add or remove a row), so an `updated_at` would always be wrong. Entity tables (users, roles, permissions, projects, cost_heads) have both. The pack said "every table"; this is a deliberate deviation.
- **Link tables use composite primary keys** instead of a separate id. `audit_log.id` is `BIGINT AUTO_INCREMENT` (strictly ordered log), the rest are `UUID`.
- **Foreign keys are `ON DELETE RESTRICT`**, except `role_permissions`, which cascades when a role or permission is deleted. Users, projects and cost heads are soft-deleted, so referenced rows are never hard-deleted.
- **`audit_log.entity_id` is a plain string, not a foreign key**, because one table records events for many entity types. `actor_user_id` is a real FK; `NULL` means the system.
- **`projects.status` is a free `VARCHAR(20)` for now.** Allowed values and transitions are Chunk 06's job (one place), so no values are baked into SQL. There is no financial column on `projects`.
- **Repositories hide soft-deleted rows** unless `{ includeDeleted: true }` is passed. They translate duplicate-key, missing-reference and in-use errors into `AppError` (generic messages, no values echoed). `UserRecord` carries `passwordHash` and is server-only; client-facing shapes will be defined in `shared/` when routes exist.
- **Role mapping in `database/seed/access.json` is provisional** (flat organisation, D6a): Admin gets all 18 permissions; Project Manager and Accountant get the 13 non-admin ones; Viewer gets `project.view`, `expense.view`, `report.view`. Change the JSON and re-run the seed; seeding is additive and never revokes.
- **Session and security defaults:** every connection runs in UTC with strict SQL mode, so MariaDB rejects over-long or invalid values rather than truncating them.

## D15. Authentication and authorization choices (Chunk 03, review these)
**Sessions**
- Server-side sessions. The cookie holds a random 256-bit token; the database stores only its SHA-256, so a database leak does not expose live sessions. A new session is issued on every login (no fixation), and signing in again revokes the previous one.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, and in production `Secure` with the `__Host-` name prefix.
- Lifetime: **12 h absolute, 120 min idle** (sliding, refreshed at most once a minute). Both are env settings (`SESSION_ABSOLUTE_HOURS`, `SESSION_IDLE_MINUTES`). All time checks use the database clock.
- Whether a user is enabled, deleted and which permissions they hold is read on **every request**, so disabling a user or changing a role takes effect immediately, at the cost of two small queries per request.

**Login**
- One generic answer (`401 INVALID_CREDENTIALS`) for wrong password, unknown email, disabled, deleted and locked accounts. One argon2 verification always runs, so timing does not reveal whether an email exists.
- **Lockout: 5 consecutive failures lock the account for 15 min** (`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES`). The counter is one atomic SQL statement, safe under parallel attempts. Only real, enabled, unlocked accounts accumulate failures. A lock that has expired restarts the count from zero. A successful login resets it. The lock does not reveal itself: a correct password during a lock gets the same 401.
- **Rate limit: 30 login attempts per 15 min per IP** (`LOGIN_RATE_LIMIT`), answered `429` with `Retry-After`. It is in memory, so **per server process**; with several instances each keeps its own count. Account lockout is what protects one account across instances. Set `TRUST_PROXY=true` only behind a trusted reverse proxy, otherwise every user shares the proxy's IP.
- Passwords: Argon2id, 19 MiB, 2 passes, 1 lane (OWASP minimum), cost stored inside each hash so it can be raised later.

**CSRF**: every state-changing request from a signed-in user must carry `X-CSRF-Token` matching its session (returned by login and `/me`). Separately, any POST/PUT/PATCH/DELETE with an `Origin` header outside `CORS_ORIGINS` is refused before any work is done, which also covers login CSRF.

**Deny by default**: a hook refuses to register any route that does not call `authenticate`, unless it is marked `config.public`. A route must also call `authorize(permission)` unless marked `config.authenticatedOnly`. A test pins the full public surface to exactly `GET /api/health` and `POST /api/auth/login`. All permission checks live in `auth/guards.ts`; tests fail if any other file calls `permissions.has`, names a system role, or reads role names.

**Project access** (`authorizeProjectAccess`): **members only, no administrator bypass.** A project that does not exist, is deleted, or has a malformed id gets the same 403 as a non-member, so responses never reveal which projects exist. Chunk 06 must add the owner as a member when a project is created. Superseded by D17: holders of `admin.projects.access` (Admin) count as members of every project.

**Audit**: `recordAudit(db, event, actor, entity, before, after)` is the only writer. It takes `db` so a service can pass its transaction and commit the audit row with the change. Event names must look like `entity.action`. Values under keys that look sensitive (`password`, `token`, `secret`, `hash`, `cookie`, `authorization`) are redacted before storage. Login events recorded: `auth.login`, `auth.login_failed` and `auth.account_locked` (known accounts only; attempts on unknown emails are not stored, so attacker-chosen text never reaches the table), `auth.logout`.

**Known gaps (by design, for later chunks)**
- ~~There is no way to create the first user yet.~~ Closed in Chunk 04 (`admin:bootstrap`, D16).
- ~~No password rules yet.~~ Length rule added in Chunk 04 (D16). Breach check and password change/reset are still not built.
- `sessions` has `created_at` and `last_seen_at` but no `updated_at`, consistent with D14.
- Expired sessions are purged on each login rather than by a scheduled job.

## D16. User administration choices (Chunk 04, review these)
- **"Admin" means a permission, not a role name.** The last-admin rule protects `admin.users.manage`: at least one enabled, non-deleted user must hold it through some role. Removing a role or disabling a user that would leave nobody holding it is refused with `409 LAST_ADMIN`. Both changes run in a transaction that first row-locks that permission, so two admins removing each other at the same moment cannot both succeed (tested, and the test fails if the lock is removed).
- **One exception to "roles are only read in repositories":** `services/user-admin.ts` lists and assigns roles by id so the admin screens can show them. A test pins it as the only exception and checks it never compares a role name.
- **Passwords: at least 12 characters, at most 1024, no composition rules** (NIST 800-63B). The admin sets an initial password when creating a user; there is no email, invite or self-service reset yet.
- **Disabling a user** deletes their sessions at once (they were already rejected on the next request). Enabling does not clear a login lockout; the lock still runs out on its own.
- **Role and project grants are idempotent** (`PUT` to add, `DELETE` to remove). A no-op writes no audit row.
- **Audit events:** `user.created` (after: email, name, role names), `user.disabled` / `user.enabled` (before/after `disabled`), `user.role_assigned` / `user.role_removed` (before/after role names), `user.project_granted` / `user.project_revoked` (project id and code). Each commits in the same transaction as its change.
- **First administrator:** `printf '%s' "$PASSWORD" | pnpm --filter @boq/backend admin:bootstrap <email> "<name>"` creates a user holding every role that grants `admin.users.manage`. The password comes from stdin, never argv. It is refused once any enabled user can manage users.
- **Project picker:** `GET /api/admin/projects` returns live projects (id, code, name) for the grant dropdown only. The real project list, with access filtering, search and pagination, is Chunk 06.
- **User list search** is a simple `LIKE` on name and email with `%` and `_` escaped, offset pagination, page size capped at 100. Chunk 13 replaces it with the shared query builder.
- **Frontend:** a minimal sign-in screen was needed to reach the admin pages at all. Navigation shows Users and Roles to every signed-in user; the server decides, and a user without the permission sees the 403 message. Hiding links per permission would need a permission check in the UI, which the architecture test forbids outside `auth/guards.ts`; revisit if wanted. No router or data-fetching library was added: a hash route and a small `useLoad` hook are enough for two pages. TanStack Query and Table (D1) can come in when a page needs them.

## D17. Admin is a member of every project (confirmed)
- Implemented as a permission, `admin.projects.access`, granted to Admin through the seed (Admin gets "all"; Project Manager and Accountant get "all-except-admin", so they do not). No code names the role.
- `authorizeProjectAccess` lets a holder into any **live** project without a `project_members` row. Missing, malformed and deleted projects still get the same 403 as for anyone else.
- Implicit, not stored: no membership rows are written, so new projects and newly appointed admins need no back-filling, and removing the Admin role removes the access on the next request.
- For later chunks: wherever "project members" means *who belongs to the project* rather than *who may open it* (Chunk 06 member list, Chunk 11 warning recipients per D11), admins count too. The repository that answers that question must add holders of `admin.projects.access` to the stored members, in one place.
- Existing databases: re-run `pnpm db:seed` to add the permission (seeding is additive).

## D18. Cost head master choices (Chunk 05, review these)
- **The seed file ships empty.** `database/seed/cost-heads.json` holds `{"costHeads": []}` because the real 32 heads have not been supplied yet (D10, DOMAIN Q9/Q12), and the workbook must not be used. Fill it in display order (`code`, `name`, optional `description`) and run `pnpm db:seed`. Until then, heads can be added in Administration > Cost Heads.
- **Seeding only adds.** A head whose code already exists (live or deleted) is left untouched, so admin edits, deactivations and order survive a re-seed. New heads are appended at the end.
- **No delete, deactivate only.** The pack allows deleting a head nobody references, but nothing can reference a head until estimates (Chunk 07) and expenses (Chunk 08) exist, so a delete now would need a reference check written for tables that do not exist yet. Deactivating covers removal; editing the code or name covers typos. The `deleted_at` column stays unused. Revisit after Chunk 08 if a real delete is wanted.
- **Codes:** 1-30 characters, letters and digits with spaces, `.`, `_`, `/` or `-` between, so `03`, `03 30 00` and `C-12` all fit. Unique without regard to case. Codes can be edited.
- **Order:** the admin sends the complete new order (every live head once). A partial or stale list is refused with 409 and nothing changes. Positions are renumbered 1..n. Create, reorder and seed take a lock on the list first, so they cannot hand out the same position.
- **Audit:** `cost_head.created` (after), `cost_head.updated` (before/after of the changed fields only; deactivation is `{active: false}`), `cost_head.reordered` (entity id `list`, before/after code order). No-ops write nothing.
- **API:** `/api/admin/cost-heads` (GET, POST), `/api/admin/cost-heads/:id` (PATCH), `/api/admin/cost-heads/order` (PUT), all behind `admin.costheads.manage`. The list of active heads for budgets and expenses, readable by ordinary users, arrives with Chunk 07, the first thing that needs it.
- **"No cost-head names in code"** is enforced by a test that checks every name in the seed file, plus the CSI MasterFormat division titles the workbook uses, against all frontend, backend and shared source.

## D19. Project management choices (Chunk 06, review these)
- **Statuses:** `planned` > `active` > `on_hold` / `completed` / `cancelled`. Allowed moves: planned > active or cancelled; active > on hold, completed or cancelled; on hold > active or cancelled. Completed and cancelled are final. Defined once in `backend/src/domain/project-status.ts`; the API sends each project's `nextStatuses`, so the UI never decides. Every project starts `planned`. Status has its own endpoint and audit event (`project.status_changed`).
- **Dates:** optional; when both are set the end must be strictly after the start (one rule, `datesInOrder` in `shared`). On edit it is checked against the stored dates, not only the patch.
- **Code** is the project's identity: unique regardless of case, and fixed after creation.
- **Owner** defaults to the creator. The owner and the creator both become members, so the creator can open what they made. Changing the owner adds the new owner as a member. The owner cannot be removed from the members; change the owner first. Owners and new members must be enabled users.
- **Members list** = stored members plus every enabled holder of `admin.projects.access`, from one repository query (D17). Administrators show as "Administrator" and cannot be removed there.
- **Project list:** only the caller's projects, or all for holders of `admin.projects.access`. That decision lives in `auth/guards.ts` (`projectListScope`) with the other permission checks. Search on code and name, offset pagination, at most 100 per page; Chunk 13 replaces it with the shared query builder.
- **Delete** is a soft delete behind a new Admin-only permission, `admin.projects.delete` (re-run `pnpm db:seed`). Afterwards the project gets the same 403 as any missing one, for everyone.
- **Non-members** get 403 on every project route, with the same body as a project that does not exist (never 404), so ids cannot be probed.
- **User lookup** (`GET /api/users/lookup`, behind `project.members.manage`) returns id, name and email of enabled users for the owner and member pickers, at most 20.
- **Audit:** `project.created`, `project.updated` (changed fields only), `project.status_changed`, `project.deleted`, `project.member_added`, `project.member_removed`. No-ops write nothing.
- **Create Project flow:** step 1 (Details) only. `CREATE_PROJECT_STEPS` in `frontend/src/pages/projects/CreateProjectPage.tsx` is the seam where Chunk 07 adds the BoQ and Review steps.
- **UI:** validation errors now show the field message from the server ("Invalid input: End date must be after the start date") instead of only "Invalid input". Dates display as DD/MM/YYYY.
