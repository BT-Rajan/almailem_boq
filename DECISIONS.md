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

## D20. Estimates and budget metrics (Chunk 07, review these)
- **`project_estimates(project_id, cost_head_id, amount_fils)`**: composite primary key (one budget per project and head), `BIGINT` fils with a database `CHECK (amount_fils >= 0)`, foreign keys `RESTRICT`. It has `updated_at` because estimates are edited. A head with no row has a budget of 0, and setting 0 is how a budget is cleared.
- **`domain/metrics.ts` is the one place budget maths happens**: `budgetMetrics({budget, actual})` gives `{budget, actual, remaining, utilisationBp}` and `totalMetrics(rows)` sums budgets and actuals first, then measures the total as one (never an average of percentages). Pure, no I/O, no thresholds. An architecture test fails if budget/actual arithmetic, `subFils`, basis-point scaling or division by a budget appears in any other source file, and a second test proves that check catches a sample formula.
- **Utilisation is integer basis points (1% = 100), rounded down**, computed with BigInt so it is exact for any safe fils value. Rounding down keeps "utilisation >= threshold" exact for whole-basis-point thresholds such as 80.00% and 100.00% (Chunk 09). Budget 0: no spend is 0%, any spend is 100% (D3). A tiny budget with enormous spend is capped at the largest safe integer so it is still a valid number. Displayed as "79.99%" by the single `formatUtilisation` formatter.
- **Actual is 0 everywhere until expenses exist** (Chunk 08 supplies it). The BoQ shows a Status column that stays empty until the control engine (Chunk 09), and an Action column (edit budget), so Budget > Actual > Remaining > % Used > Action is visible.
- **Which heads appear:** every active head, plus any inactive head that still carries a budget, so totals never hide money. An inactive head cannot take a new non-zero budget (409); its budget can be set to 0.
- **Locked projects:** budgets cannot change once a project is completed or cancelled (409 `PROJECT_CLOSED`; `acceptsFinancialChanges` in `domain/project-status.ts`, which also closes spend from Chunk 08).
- **Concurrency:** a budget edit row-locks the project first, so concurrent edits on one project run one after the other and the audit before/after chain stays consistent. (Locking the estimate rows was not enough: a new project has none, and the two edits deadlocked. The concurrency test found this; it fails if the lock is removed.)
- **Audit:** one `estimate.changed` row per head that actually changed, on the project, with `{costHeadId, code, amountFils}` before and after. Unchanged heads write nothing.
- **Out of range:** a budget or total beyond the safe-integer range (about 9 trillion KWD) is refused with 400 `AMOUNT_OUT_OF_RANGE`, and the whole batch rolls back.
- **Create Project:** step 1 creates the project, step 2 (BoQ) saves budgets for the active heads, step 3 (Review) shows the server's figures. Steps 2 and 3 have their own addresses (`#/projects/:id/setup/boq|review`), so the flow survives a reload. Step 2's running total adds up what has been typed with the shared `sumFils` helper; it is a draft sum of inputs, not a budget formula, and the saved total on Review comes from the server.
- **KWD input** accepts "125,000.5"; it is converted to fils at the UI edge with the shared `kdToFils` and checked with the shared amount schema before sending.

## D21. Expenses, reversals and attachments (Chunk 08, review these)
- **Never deleted.** "Delete" is a reversal: a negative entry linked to the original (`reversal_of`), dated the day of the reversal, carrying a required reason. The original stays and is marked `reversed_at`. An expense is reversed at most once (unique `reversal_of`), and a reversal entry cannot itself be reversed or edited. The database enforces the signs: originals are positive, reversals negative.
- **Actual per head** = the sum of original expenses that are not reversed, in one SQL `SUM` in the expenses repository (cast to BIGINT so it stays an exact integer), then passed to `budgetMetrics`. Reversal entries are the record of the correction and are not counted again. A test checks that all entries together net to the same number.
- **Duplicates:** one live invoice per project, vendor and invoice number, ignoring case, enforced by a unique key on a generated column. Reversals and reversed originals do not count, so a wrong entry can be reversed and entered again correctly. Simultaneous duplicates: exactly one is saved.
- **Editing** corrects a live expense (head, vendor, invoice, date, amount, description) and audits the changed fields. It needs a new permission, `expense.edit` (all working roles; re-run `pnpm db:seed`). Spend may only go to active heads.
- **Closed projects:** completed or cancelled projects take no new, changed or reversed spend (409 `PROJECT_CLOSED`). The same rule (`acceptsFinancialChanges`) closes budgets; the estimates error code changed from `BUDGET_LOCKED` to `PROJECT_CLOSED` to match.
- **Locking:** every spend change locks the project row, then the expense row, always in that order. Chunk 10 will need this when it checks the projected status before saving.
- **Attachments:** one bill per expense (PDF, JPG or PNG), uploaded as the raw request body to its own route (`PUT .../expenses/:id/attachment`) with the original name in `X-File-Name`. No multipart library was needed.
  - The **file's bytes decide its type**, and they must match the declared type; anything else is 415. HTML, SVG, ZIP or EXE bytes are refused even when labelled as PDF.
  - **Size cap** `ATTACHMENT_MAX_MB` (default 10), enforced by the body parser of that route only (413).
  - **Stored** under `ATTACHMENTS_DIR` (default `data/attachments`, git-ignored) with a random 32-hex name, file mode 0600. The key is checked before it touches a path and never leaves the server. Replacing a bill removes the old file after the change commits; a failed upload leaves no file.
  - **Served** only by `GET .../expenses/:id/attachment` behind `expense.view` and project access, always as a download (`Content-Disposition: attachment`) with the sniffed type, `nosniff`, `no-store` and a sandbox CSP. An expense id from another project is "not found".
  - Production must point `ATTACHMENTS_DIR` at persistent storage outside any served directory, and back it up with the database (Chunk 18).
- **Audit:** `expense.created`, `expense.updated` (changed fields), `expense.reversed` (with the reason and the reversal id), `expense.attachment_added`.
- **UI:** "Add expense" on the project BoQ tab and on each cost-head page; each head in the BoQ links to its detail page (Budget, Actual, Remaining, Used, then every entry, reversals in red, with Edit, Reverse and the bill). The expense is saved first and the bill uploaded second; if only the upload fails, the form says the expense was saved without the bill.
- **Not in V1:** pending (approval) status, which arrives with Chunk 10.

## D22. Budget control engine (Chunk 09, review these)
- **`domain/control.ts` is the one place thresholds are compared.** `calculateBudgetStatus(utilisationBp, thresholds)` gives `NORMAL`, `WARNING` or `APPROVAL_REQUIRED`; `projectedStatus({currentActual, newAmount, budget}, thresholds)` gives the figures and status a head would have after an expense (negative amount for a reversal). Pure, no I/O. The figures come from `domain/metrics` (a new `projectedMetrics` there does the addition), so control does no money maths of its own.
- **Exact comparison:** utilisation is whole basis points rounded down, and thresholds are whole basis points, so `utilisation >= threshold` is exact. 79.99% (and 79.9999%) is Normal, 80.00% is Warning, 99.99% is Warning, 100.00% and above need approval. The tests check this against exact rational maths for every budget from 1 to 400 fils (over 80,000 cases), 20,000 seeded random large values with random thresholds, the smallest fils that crosses each threshold for awkward budgets, and that more spend never lowers a status.
- **Thresholds are data:** one row in `budget_thresholds` (migration 0010 creates it with 8000 / 10000 basis points). The database allows exactly one row and requires `1 <= warning < approval <= 100%`. Approval can start at 100% at most, so spend on a zero budget always needs approval (D3), whatever the settings.
- **Editable in Administration > Approval Rules** (`admin.approvalrules.manage`), entered as percentages with up to 2 decimals and stored as basis points. A change applies to every status on the next request. Audited as `budget_thresholds.updated` with before and after.
- **"80 and 100 only in config and tests"** is an architecture test: no source file contains 80, 0.8 or 8000. 10000 appears only as `BP_PER_WHOLE` in `shared/src/budget.ts` (the unit of utilisation, 100%, not a threshold) and in an unrelated rate-limit cap. Utilisation and thresholds are compared only in `domain/control.ts` (the settings schema may check warning < approval), and only it returns a status.
- **Where status shows:** each BoQ row and the project total (a dot plus Normal / Warning / Approval), the cost-head detail, and a live preview in Add Expense ("After this expense: Actual, Remaining, Used, status"), from `GET .../cost-heads/:id/projection?amountFils=` (needs `expense.create`; saves nothing). The preview waits until typing pauses.
- **Total status** is measured on the project total (summed budget and actual), so one over-budget head does not by itself turn the total red; the head's own dot does.
- **Not yet:** nothing is blocked. An expense that reaches the approval level is saved like any other and only shows the warning; holding it for approval is Chunk 10.

## D23. Dashboard (Chunk 12, review these)
- **Chunks 10 and 11 were skipped at the owner's request.** The dashboard therefore has no "Pending approvals" figure yet: approvals do not exist, and showing 0 would be misleading. The service and page mark the place; Chunk 10 adds it.
- **`GET /api/dashboard`** (behind `project.view`) returns a headline (projects, budget, actual, remaining, used, status) and one row per project the caller may see (all of them for administrators, D17). Sums come from SQL, one query per widget. Every derived figure comes from `domain/metrics` and every status from `domain/control`. The headline sums the project table's own query, and a test checks that it equals the sum of the rows and that each row equals that project's BoQ total and status.
- **UI rule over the pack's column list:** the pack lists Project, Budget, Actual, Used, Status. The UI rules require Budget > Actual > Remaining > % Used > Action wherever money appears, so the table and the headline also show Remaining, and each row has an Open action.
- **Home page** is now the dashboard (`#/dashboard`); the projects list stays at `#/projects`.
- **Project page header:** the BoQ tab opens with the project figures (Budget, Actual, Remaining, Used, Status) above the cost-head table. "Needs attention first" asks the server for `?order=attention`: heads needing approval, then warning, then the rest, keeping display order within each. The ranking lives in `domain/control` (`byUrgency`), because it is about what the statuses mean.
- **Performance:** migration 0011 adds a covering index on expenses and the queries were reshaped after EXPLAIN showed a full scan at scale. Details and EXPLAIN output in PERFORMANCE.md. The pack's 300 ms target is checked by a test on 100 projects x 32 heads x 5,000 expenses.
- **Shared figures strip:** `Figures` is one component, used by the dashboard, the project header and the cost-head page (it replaced the copy in the cost-head page).

## D24. Search, filter, sort and pagination (Chunk 13, review these)
- **One pattern, three layers:**
  - `shared/src/list-query.ts`: `listQuerySchema(sorts, filters)` gives `q`, `sort` (allow-listed), `dir` (`asc`/`desc`), `page`, `pageSize` (at most 100) and allow-listed filters. It is strict, so any other query parameter is a 400.
  - `backend/src/query/list.ts`: `runList(db, spec, input, conditions)` builds count and page queries from a fixed SQL spec written in a repository, checks the sort key again (own keys only, so `__proto__` cannot sneak through), binds every value, and appends a unique tiebreaker so paging is stable. `memberScope` is the single "projects this user may see" condition, now also used by the dashboard and global search.
  - `frontend/src/components/list.tsx`: `useList` (search text with a typing pause, sort, page), `SortHeader` and `Pager`.
- **Adopted** by Users (sort by created, name, email), Projects (code, name, status, start, end; filter by status) and the cost-head expense list (date, amount, vendor, invoice). The three hand-written repository searches and the three copied pagers were deleted. The list query parameter is now `q`, not `search`. The cost-head admin list is not paged (it is the full ordered master), and the user picker keeps its 20-result lookup.
- **Global search** (`GET /api/search?q=`, at least 2 characters) returns up to 8 of each: projects, cost heads, invoices, vendors (with how many expenses and projects) and expenses (by description). Everything project-scoped passes through `memberScope`, and administrators see all (D17). Reversal entries and deleted projects are left out. It is the header search box.
- **The architecture rule for SQL** now reads: repositories/, db/ and the list builder (query/).
- **Acceptance "net lines of code decrease after adoption" is not met:**
  - Adoption removed 47 lines from the files that adopted it.
  - The shared pattern is 264 lines: builder 106, schema factory and types 60, hook and components 98.
  - The three lists it replaced were already short, and the pattern adds sorting and filters they did not have. The saving comes as more lists adopt it (reports in Chunk 14, the audit viewer in Chunk 16).
  - Whole codebase: 7,656 to 8,049 source lines, including the new global search.
- **Performance and indexes:** migration 0012 and PERFORMANCE.md.

## D25. iPad (Chunk 17, review these)
- **Touch rules apply on touch devices only** (`@media (pointer: coarse)`), so desktop stays dense. On a touch screen:
  - every button, link, field and checkbox label is at least 44 px;
  - Add Expense, edit/reverse expense and the budget edit open as **bottom sheets** (the existing `SlideOver` with `sheet`; no new component), whose main button stays at the bottom of the sheet;
  - the page's main action (**Add expense** on the project BoQ and the cost-head page) sits in the **bottom-right corner**, where a thumb rests holding an iPad.
- **At every size:**
  - the page never scrolls sideways: the header wraps, the nav scrolls within itself, and toolbars wrap;
  - wide tables scroll inside their panel with the **first column kept in view**;
  - money tables keep one line per row, with long names and descriptions cut by an ellipsis (full text on hover), so that in landscape every column through **Action** fits without scrolling.
- **Camera:** the bill field gains a "Take photo" input with `capture="environment"` (rear camera, JPEG/PNG), shown on touch devices only. The ordinary file picker stays for PDFs.
- **Checks:** `pnpm test:ipad` runs Playwright on the real UI at 1024x768 and 768x1024 with touch, API mocked (no database). For eight screens it checks no sideways page scroll and 44 px targets. It also checks:
  - the sticky first column and one-line money rows;
  - that the landscape BoQ fits through Action;
  - that Add Expense is a full-width bottom sheet with nothing painted over it and its button under the thumb;
  - the corner action's position, and the camera input.
  Screenshots land in `frontend/test-results/` (ignored by git). Removing the touch CSS fails 20 of the checks.
- **Not in `pnpm test`:** the iPad checks need a Chromium build, which this container pre-installs. Elsewhere, run `pnpm --filter @boq/frontend exec playwright install chromium` once. CI should run `pnpm test:ipad` as its own step.
- **Approvals as bottom sheets:** there are no approval actions yet (Chunk 10 was skipped). When it lands, its actions should use `SlideOver sheet` and the `primary-action` class.
- **Found by looking at the screenshots and then covered by checks:** sticky table cells and the corner button painted over the open sheet (the backdrop had no stacking level), and the portrait BoQ squeezed long names into tall rows instead of scrolling.

## D26. Hardening (Chunk 18)
Findings, fixes and accepted risks are in HARDENING.md; deployment in DEPLOY.md; latencies in PERFORMANCE.md. Decisions worth reviewing:
- **The access policy is pinned in a test** (route, permission, project-scoped). Changing who may call a route now means editing that table, so it shows in review.
- **New public route `/api/ready`** for load balancers: it says only "ready" or 503.
- **Bill uploads are limited** to 120 per user per hour (`ATTACHMENT_UPLOADS_PER_HOUR`).
- **Dependencies:** vitest moved from 3 to 4.1.11 and esbuild is pinned to 0.28.1 or later through a pnpm override, to clear the audit (all findings were development-only).
- **Two database accounts in production:** the app's (data only, so it cannot alter tables or the audit triggers) and an admin one for migrations, backups and restores.
- **The app's CSP** is set by the web server and was verified against the production build.
- **Not hardened, because not built:** approvals (10), notifications (11), reports and exports (14), Excel import (15), audit viewer (16). HARDENING.md marks each related check N/A; they must be done when those chunks land.

## D27. Cost heads are entered in the app, in any number (confirmed)
Supersedes the "32 heads, to be supplied" parts of D10 and D18. Admins create, edit, reorder and deactivate cost heads in Administration > Cost heads. There is no fixed count: 10, 32 or 50 all work, and nothing in the code assumes a number. The only limit is 500 heads, which the reorder screen and the seed file accept in one go. `database/seed/cost-heads.json` stays optional: it can preload a list, but an empty file is the normal starting point.

## D28. One-command install under pm2
`installer.sh` sets up a single server and runs the app under pm2, following the jdk_erp installer. DEPLOY.md section 0 has its usage. Decisions worth reviewing:
- **Two processes:**
  - `boq-api` binds `127.0.0.1:3100`, so it is reachable only through the web process.
  - `boq-web` is `vite preview` on port 7180. It serves the built app with the same strict CSP as the nginx example and proxies `/api`. No nginx is needed for a LAN install. nginx (DEPLOY.md sections 6–7) stays the recommended setup with https.
- **New setting `COOKIE_SECURE`** (`auto`, `true` or `false`). With `auto`, behaviour is unchanged: secure cookies in production. A plain-http install needs `false`, because browsers drop `Secure` cookies on http. HSTS follows the same switch. The installer sets it from the scheme of `PUBLIC_URL` and warns about plain http on anything but localhost.
- **`TRUST_PROXY` gains `loopback`:** forwarded addresses are trusted only from a proxy on the same machine. This keeps per-client login rate limits correct behind `boq-web`, and nobody else can spoof the address.
- **Database accounts as in D26:**
  - `boq_app` has data rights only and is the account in `backend/.env`;
  - `boq_admin` runs migrations and seeds.
  Passwords are generated once and kept in `.install.env` (mode 600, git-ignored). A re-run never rotates them.
- **The first administrator** is created only when the database has no users, through the existing `admin:bootstrap`.
- **The secrets scan ignores database URLs whose password is a shell variable** (`$pass`, `$(urlenc …)`). A literal password still fails it.
- **Node.js 20.19 or newer**, not only 22. Production servers may already run Node 20 for other apps, and the installer must not replace it. Nothing in the app needs 22:
  - Vite is the strictest dependency, at `^20.19.0`;
  - `process.loadEnvFile` exists since Node 20.12;
  - the backend bundle targets `node20`.
  `cookie@2` (under `@fastify/cookie`) declares Node 22 in its metadata, but the full test suite passes on Node 20.20. The installer keeps any Node.js at 20.19 or newer, and installs Node 22 only when there is none. `.nvmrc` stays at 22 for development.

## D29. Approval workflow (Chunk 10)
Supersedes the "Not yet: nothing is blocked" note in D23, and settles the open point in D6a.
- **Only administrators decide.** `approval.decide` belongs to the Admin role alone, as the chunk asks (a non-admin gets 403). This overrides D6a's proposal that every working role could decide.
  - The seed now treats `approval.decide` like the `admin.*` permissions.
  - Migration 0013 removes it from any role that cannot also manage users. It is the one migration that edits grants, because the additive seed would never take it back.
  - Every working role keeps `approval.request`.
- **The requester never decides.** This holds even for an administrator; a CHECK constraint backs it up. With only one administrator, their own over-budget spend waits until a second administrator exists, or they cancel it.
- **Expenses gain a status:** `POSTED`, `PENDING_APPROVAL`, `REJECTED` or `CANCELLED`.
  - Only POSTED counts toward Actual. The rule is written once, as `countsTowardActual` in `repositories/shared.ts`, which the BoQ and the dashboard both use.
  - Reversal entries are always POSTED.
  - A held expense keeps its invoice number; a rejected or cancelled one frees it to be entered again.
- **When approval is needed:** when Add Expense's projection from `domain/control` (the same one the preview shows) is APPROVAL_REQUIRED.
  - The expense is saved as held, with an approval request carrying the mandatory reason (400 without one).
  - WARNING needs no approval.
  - Nothing in the approval code compares thresholds; they stay data (D22), and the tests show approvals following edited levels.
- **One state machine,** in `domain/approval-status.ts`: PENDING to APPROVED, REJECTED or CANCELLED, all final.
  - Each step writes four things in one transaction: the request, its expense's status, an `approval_actions` row (append-only, enforced by triggers) and an audit event.
  - Rejecting needs a comment; approving takes an optional one.
  - The requester can cancel a waiting request.
- **Re-evaluation:** at decision time the head is re-measured with the control engine and today's budget, actual and thresholds. The utilisation is recorded both at request (`requested_bp`) and at decision (`decided_bp`). The Approvals page shows each waiting request re-evaluated live.
- **Edits can't bypass approval.** An edit that adds spend to a head and would bring it to the approval level (a larger amount, or a move to another head) is refused with 409 `APPROVAL_REQUIRED`: reverse the expense and enter it again with a reason. An edit that reduces spend is always allowed. Held, rejected and cancelled expenses cannot be edited or reversed.
- **Approving needs an open project;** rejecting and cancelling do not, because they add no spend.
- **Locks:**
  - Order: project, then expense, then approval request.
  - The rows to lock are looked up before the transaction starts (see HARDENING C3).
- **UI:**
  - **Approvals page** (Admin): waiting requests oldest first, with Budget, Actual, Remaining after, Used after, status dot, reason and Decide. The decision is a bottom sheet with the head's after-figures. Text columns are cut short and the status is a dot alone, so every money column and Action fit a landscape iPad (checked).
  - **Add Expense** asks for the reason when the preview reaches the approval level.
  - **Cost-head page** marks held, rejected and cancelled entries, and offers Cancel request.
  - **Dashboard** counts pending approvals in the user's projects.
- **Not built:** notifications (Chunk 11), multi-level chains, and hiding Cancel request from members other than the requester (the server refuses them with a clear message).

## D30. Look and feel follows the Almailem roadmap UI (light theme only)
The owner asked for the app to resemble `BT-Rajan/almailam-roadmap-ui`, in its light theme only. That app is Vue with Tailwind; ours stays React with plain CSS, so the design is carried over, not its code. Done so far: sign-in and dashboard, plus the app shell every page sits in.
- **Supersedes parts of CLAUDE.md's UI RULES:**
  - the page is the roadmap's cool grey (`#f3f5f9`), not `#F8F9FA`;
  - cards get 12–16 px corners and soft slate shadows;
  - the dashboard has a blue gradient greeting banner.
- **The data rules stay:**
  - Budget > Actual > Remaining > Used > Action wherever money appears;
  - status dots only;
  - dense tables;
  - no charts.
- **Taken from the roadmap UI:**
  - its tokens: corporate blue `#1d4ed8`, slate text greys, hairline borders;
  - Inter for text and Plus Jakarta Sans for headings and figures;
  - a white sidebar with icons and an active item tinted blue with an edge bar, Administration grouped;
  - a top bar with search and the user;
  - a split-screen sign-in with a hero line;
  - stat tiles with coloured top edges and icon badges.
- **Fonts are self-hosted** (`@fontsource`, Latin subset only), because the CSP allows fonts from our own origin only. Icons come from `lucide-react`, the React build of the roadmap's icon set.
- **The sidebar shows from 1280 px wide.** Narrower screens, iPads included, get a menu button and a drawer, so the money tables keep the full width the landscape iPad checks require.
- **Not done yet:** the other pages (projects, BoQ, cost head, approvals, administration) take on the new colours, fonts and cards through the shared styles, but keep their own layouts.

## D31. Budgets are approved by an administrator, and frozen once approved
A project's cost structure (which cost heads apply, and the estimate for each) is proposed by a member and approved by an administrator. This applies when a project is first set up and to every later change.
- **One approval system.** A budget request is a second kind of row in `approvals` (`kind = BUDGET`, migration 0015). It uses the same state machine (`domain/approval-status`), `approval_actions` history, audit events, approve and reject routes, `approval.decide` permission and no-self-approval rule as spend approval.
- **Request lines.** The heads and amounts are stored head by head in `approval_budget_lines` (append-only):
  - `approved_fils`: the approved estimate when the request was made; empty when the head is being added.
  - `amount_fils`: the proposed estimate; empty when the head is being removed.
  So every request records what changed, the previous approved value and the proposed value. With the approval's requester, decider and timestamps, that is the full audit record.
- **The approved budget stays `project_estimates`**, the only figures the BoQ, dashboard and spend control read. Only an approval writes it, in one transaction:
  - the proposed amounts are written;
  - removed heads are deleted;
  - each change is audited (`estimate.changed` / `estimate.removed`).
  Approval is refused if the approved budget moved after the request; reject it and resubmit.
- **Frozen.** Normal users cannot edit the approved budget. `PUT /api/projects/:id/estimates` now needs `approval.decide`, so only administrators can make direct corrections, which are audited. The UI no longer offers a per-head budget edit.
- **Changes are proposals.** Proposing the whole structure again expresses every supported change: add a head, change an estimate, or remove a head (by leaving it out). One budget request may wait per project, enforced by a unique key, so changes cannot conflict. A request that changes nothing is refused.
- **Expense protection.** A head with expenses (posted or awaiting approval, reversals included) cannot be removed. The server refuses this when the request is submitted and again when it is approved; the UI keeps such heads ticked and locked. Their estimates can still change.
- **Existing projects** keep their estimates as their approved budget. Nothing is rewritten and no approval is forced on them.
- **The flow:** Details, Select costs (two-column checkboxes, showing the C number and name), Enter estimates (tap a row; amounts in KWD are exact, and more than 3 decimals is refused, not rounded), Submit, then approval. The project page shows the approved, waiting or rejected state, with a link to propose a change or to correct and resubmit. Approvals has a Budgets tab showing each head's approved and proposed values, with totals.

## D32. Expense lifecycle: budget heads only, audited edits, admin-only soft deletion
- **Expenses go on approved budget heads only.** Creating an expense, or moving one to another head, is refused (`HEAD_NOT_IN_BUDGET`) unless the head is active and in `project_estimates`. A head approved at 0 still qualifies, so the zero-budget rule (D3) is unchanged. The expense form lists only such heads (`BoqRow.inBudget`).
- **Every change records who and when.** `expenses.updated_by` (migration 0016) is set on edit, approval decision, reversal and bill upload, next to the existing `updated_at`. The API returns them as `modifiedBy` and `modifiedAt`. What changed stays in the existing audit trail (`expense.updated` and the rest). There is no second history table.
- **Only administrators delete** (`admin.expenses.delete`, granted to Admin only). Deletion is soft: `deleted_at` and `deleted_by` are set and the row is kept, together with its audit history and the `expense.deleted` event, which records who, when and the amount. Everyone else still corrects with a reversal.
  - **Refused:** reversal entries, reversed originals (delete would unbalance the pair), and expenses waiting for approval (cancel those instead).
  - **The UI** shows Delete only to holders of the permission. The server enforces it either way.
- **Deleted expenses do not exist for figures.** `countsTowardActual` excludes them, so the BoQ, dashboard, control projection and reports all follow from one place. Lists, cost-head detail and search exclude them too. The invoice uniqueness key ignores them. The threshold algorithm is unchanged.
- **Removal protection.** A project cost head with any expense that has not been deleted (posted, waiting, rejected, cancelled or reversed) cannot leave the budget, and that applies to administrators as well. The check runs both when a request is submitted and when it is approved (D31). Once a head's only expenses have been deleted, it can be removed. This concerns a project's budget lines, not the global cost-head master (`admin.costheads.manage`), whose rules are unchanged.

## D33. KWD input has 3 decimals; project summary and expense drill-down
- **Three decimals, never rounded.** Kuwaiti dinars have 3 decimals (fils). Every KWD amount typed in the UI, for both expenses and estimates, goes through one parser (`parseKwdInput`). It refuses a 4th decimal instead of rounding it. The API only accepts integer fils.
- **Project summary** is the project page's Summary tab, built on the existing BoQ response with no second calculation:
  - Rows: one per approved cost head (`inProjectSummary`), plus any head that still carries spend from before budgets were approved, so the rows always add up to the server's total.
  - Columns: Cost Code (C number), Cost Head, Approved Estimate, Actual, Remaining, Utilisation %, Status, Action.
  - Totals: shown above the table, from the server's `total`.
  - Approved figures only: the estimate is always `project_estimates`, so a pending budget change never counts (D31).
- **Drill-down:**
  - A summary row opens the cost-head page, which lists that project and head's expenses with a Status column.
  - Tapping an expense opens its detail in a bottom sheet: `GET /api/projects/:id/expenses/:expenseId`, which needs `expense.view` and project membership, like the list and the bill.
  - An expense from another project is not found.
- **History** is read from the existing audit trail: the expense's own events and those of its approval request. It is shown as plain actions (Created, Modified, Bill uploaded, Reversed, approval steps, Deleted), each with who, when, and the field changes or note. Nothing new is recorded.
- **Deleted expenses** stay out of the active list and the figures. Each cost-head page has a folded "Deleted expenses" list, and each entry opens its record and full history, marked deleted. A deleted expense's bill is no longer served.

## D34. Estimate vs Actual chart on the project summary
- **Plain HTML and CSS bars**, horizontal and grouped (Estimate, then Actual), placed under the summary table. No chart library was added: two bars per head do not need one.
- **Same figures as the table.** The chart reads the summary's BoQ rows, with the same filter (`inProjectSummary`), the same order and the same `metrics`. It sums nothing and queries nothing else.
- **Honest scale.** Every bar is a share of the largest figure shown, so an Actual above its Estimate is drawn longer and never capped. Each bar carries its exact value, formatted with `formatFils`. An Actual above its Estimate is shown in red.
- **Interaction and layout.** Each head links to the same cost-head page as its table row. With many heads the list scrolls inside the chart. With no approved heads, a one-line empty state replaces the chart. Colours (teal Estimate, brand-blue Actual) pass the palette checks.

## D35. The budget and expense workflows say what state they are in
- **Budget steps.** The budget steps are: Details, Select costs, Enter estimates, Review (each head's approved value, proposed value and change), then Submit for Admin approval. While a request waits, the editor shows step 5, Admin approval, and lists the pending lines.
- **Project page banner.** It names the state: pending Admin approval (with "View changes"), rejected, or approved. While a change is pending or after a rejection, it says that the approved budget is still in force.
- **Expenses need an approved head.** The Add expense button is offered only where an approved budget head exists, and the expense form names heads by their C number. A cost head outside the budget says it takes no new expenses.
- **Rule refusals read as business messages.** `authorize()` takes an optional message for the refused user:
  - "Only an Admin can remove an expense."
  - "Only an Admin can approve or reject."
  - "This approved estimate cannot be changed directly…"
  - A second budget request: "This budget is awaiting Admin approval…"
  - A spent head: "Cost head Cxxx cannot be removed because expenses exist."
