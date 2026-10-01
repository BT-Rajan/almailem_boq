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
