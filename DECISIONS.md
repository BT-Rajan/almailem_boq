# DECISIONS

Status: **PROPOSED**, pending review. Nothing here is built yet. Updated after domain Q&A (D3, D6, D8).

## D1. Stack (proposed)
| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) end to end | One type system for shared schemas (rule 4); matches the draft plan |
| Backend | Node.js + Fastify | Small, fast, schema-first validation, low ceremony for a ~35K LOC target |
| Validation | Zod, defined in `shared/` | One schema used by API and UI (rules 4, 7) |
| Database | PostgreSQL | Row locks / serialisable transactions for approvals (Chunk 10, 18), exact `bigint` money, strong constraints |
| DB access | Plain SQL via `pg` with a thin repository layer and SQL migrations | Parameterised only (rule 8), no ORM magic, easy EXPLAIN tuning |
| Frontend | React + Vite, TanStack Query and Table | Dense tables and bottom sheets for iPad; no logic in components |
| Tests | Vitest, plus Playwright for iPad viewport checks | Covers Chunks 1, 17, 18 |
| Package manager | pnpm workspaces (`frontend`, `backend`, `shared`) | Single install, shared package |

Repo was empty at Chunk 00, so there is no existing convention to follow. **Needs your confirmation or a swap before Chunk 01.**

## D2. Money
Integer fils (1 KWD = 1000 fils), stored as `bigint`, handled in the app as `bigint`/safe integers. Never floats. Formatting to `KWD 1,234.567` happens once, at the UI edge, through the shared money helper. Multi-currency is out of scope for V1 unless the workbook shows otherwise (see Q3).

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
