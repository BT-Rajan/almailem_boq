# HARDENING

Chunk 18 review: security, financial correctness, concurrency, performance and operations. Each finding has its fix or the risk accepted, and where it is tested.

- **Scope note:** Chunk 10 (approvals) has since been built (D29); its checks are filled in. Chunks 11 (notifications), 14 (reports and exports), 15 (Excel import) and 16 (audit viewer) were not built (skipped at the owner's request). Checks that depend on them are marked **N/A** and must be done when those chunks land.
- **Test status:** backend 507, frontend 37, shared 49, contract and secrets 10, iPad 23 (+1 skipped by design). Lint, typecheck and build are clean.

## Security

| # | Finding | Fix / decision | Tested in |
|---|---|---|---|
| S1 | **No authorization matrix:** each route had its own access tests, but nothing proved every route against every role. | The route registry now records each route's permissions and project scope. A matrix test calls **every route x 5 roles (Admin, Project Manager, Accountant, Viewer, no role) x member/non-member** and checks each gets exactly what its guards promise; all routes refuse signed-out callers with 401. The **reviewed access policy** (route, permission, project-scoped) is pinned, so any change to it shows in review. | `routes/authz-matrix.test.ts`, `auth/route-policy.test.ts` |
| S2 | **No security headers** on API responses. | Every response gets a CSP (`default-src 'none'`), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CORP/COOP, `Permissions-Policy`, `Cache-Control: no-store`, plus HSTS in production. The bill download keeps its stricter sandbox policy. | `http/hardening.test.ts` |
| S3 | **The single-page app needs its own CSP** (it is served by the web server, not the API). | DEPLOY.md gives a strict policy: `script-src 'self'; style-src 'self'`, no inline. It was verified against the production build in a browser with **no violations**, and the build has no inline scripts or styles and no `eval`. | manual check, recorded here |
| S4 | **Bill uploads were not rate limited.** | Per user, 120 per hour by default (`ATTACHMENT_UPLOADS_PER_HOUR`); 429 with `Retry-After`. | `http/hardening.test.ts` |
| S5 | **Dependency audit:** 2 moderate (vitest, dev only), 1 low (esbuild via tsup, dev only); none in production dependencies. | Upgraded vitest 3 to 4.1.11; pnpm override `esbuild >= 0.28.1`. `pnpm audit` now reports **no known vulnerabilities**. | `pnpm audit` |
| S6 | **Secrets scan.** | A test scans every tracked file for private keys, cloud and chat tokens, API keys, password literals and database URLs with passwords, and checks no `.env` is committed. One false positive (an example URL in a comment) became an explicit `<password>` placeholder. `.env.example` uses `change-me` placeholders. | `tests/src/secrets.test.ts` |
| S7 | **Sensitive data in logs.** | Verified: after sign-in, sign-in failure and authenticated calls, the logs contain no password, session token, CSRF token, cookie or hash (Fastify logs method and URL, not headers; cookie and authorization headers are redacted anyway). Unexpected errors are reported with the route pattern only, never ids or query strings. | `http/hardening.test.ts` |
| S8 | **Input validation review.** | Every route parses params, query and body with a shared Zod schema before its service runs. List queries are strict allow-lists (Chunk 13). Money is integer fils with safe-range checks, and out-of-range totals return 400 rather than 500. No route reads unvalidated input. | route tests per chunk; `query/list.test.ts` |
| S9 | **Sessions, lockout, CSRF, CORS** (re-verified). | Unchanged from D15 and still covered: hashed session tokens, 12 h absolute / 120 min idle, `__Host-` Secure cookie in production, 5-strike lockout, 30 logins per 15 min per IP, CSRF on every write, Origin check, CORS allow-list. | `auth/auth.test.ts`, `http/hardening.test.ts` |
| S10 | **Attachments** (re-verified). | Type decided by magic bytes, which must match the declared type; size cap; random names, mode 0600; served only as a download behind project access, with a sandbox CSP. | `routes/expenses.test.ts` |
| S11 | **Excel import limits.** | **N/A**: Chunk 15 is not built. | |
| A1 | **Accepted risk:** login and upload rate limits are in memory, per process. | With one API process (DEPLOY.md) this is exact; account lockout is in the database and holds across processes. With several processes, use a shared store. | |
| A2 | **Accepted risk:** expired sessions are purged at each sign-in, not on a schedule. | They are already refused on use. The table only grows with abandoned sessions, which the next sign-in clears. | |
| A3 | **Accepted risk:** the app's database account must not have DROP, ALTER or TRIGGER, or the append-only audit log could be bypassed. | DEPLOY.md section 2 grants it data rights only. | |

## Financial correctness

| # | Check | Result | Tested in |
|---|---|---|---|
| F1 | Actual per head = the sum of original expenses that are not reversed; Remaining = Budget - Actual; Used = floor(Actual x 10000 / Budget), with D3 for a zero budget; status follows the thresholds. | A **seeded 120-step random sequence** of real API calls (adds, reversals, amount edits, moves between heads, budget changes) is checked every 10 steps against an independent model. | `routes/financial-properties.test.ts` |
| F2 | BoQ total = sum of heads; dashboard row = BoQ total; cost-head detail = BoQ row; the ledger (reversals included) nets to Actual. | Checked at the same points in that sequence. | same |
| F3 | Reports and exports agree with the dashboard. | **N/A**: Chunk 14 is not built. | |
| F4 | Rounding and boundaries (79.99 / 80.00 / 99.99 / 100.00 / 100.01, zero budget, negative, large values). | Re-run in this chunk: exhaustive comparison for budgets 1 to 400 fils, 20,000 random cases, the smallest crossing fils for awkward budgets. | `domain/control.test.ts`, `domain/metrics.test.ts` |

## Concurrency

| # | Check | Result | Tested in |
|---|---|---|---|
| C1 | Simultaneous adds, reversals, edits and a budget change on the same heads. | A concurrent burst (20 adds, 8 reversals, 6 edits, a budget change) ends exactly at the model's figures. Every money change locks the project row, then the expense row, always in that order. | `routes/financial-properties.test.ts` |
| C2 | Double reversal, duplicate invoices, concurrent budget edits, last administrator. | Exactly one succeeds in each case (earlier chunks). Each test was checked to fail without its lock. | `expenses.test.ts`, `estimates.test.ts`, `admin-users.test.ts` |
| C3 | Simultaneous approvals and double approval. | Each decision locks project, then expense, then approval request, and re-reads after locking. The lookup that finds which rows to lock runs before the transaction: under REPEATABLE READ an earlier plain read would freeze the snapshot. The first version did that, and two administrators both succeeded; the test caught it. A second decision on a decided request is 409. Self-approval is refused in the service and by a database CHECK. | `approvals.test.ts` (two admins at once: exactly one 200; double approve 409; self 403), `financial-properties.test.ts` |

## Performance

| # | Finding | Fix | Where |
|---|---|---|---|
| P1 | Dashboard query read every expense: 6 s at 500,000 expenses. | Covering index and per-project sums: 130 ms (Chunk 12). | PERFORMANCE.md |
| P2 | p95 under load for every hot read and write. | All met with a wide margin. Worst read: 134 ms (all-projects dashboard); worst write: 33 ms. The test fails if a target is missed. | `routes/load.test.ts`, PERFORMANCE.md |

## Operations

| # | Item | Result | Where |
|---|---|---|---|
| O1 | **Backup and restore** | `scripts/backup.sh` (consistent dump with triggers, bill archive, SHA-256 manifest) and `scripts/restore.sh` (refuses a non-empty target). **`scripts/verify-restore.sh` proved a backup restores to a working app:** row counts and bill checksums identical, audit log still append-only, no pending migration, app ready, sign-in, dashboard and a bill download all working. | DEPLOY.md section 8 |
| O2 | Bugs found while building O1, both fixed | (a) The check correctly refused a restore whose source database was one migration behind. (b) The verification left the app process running after it finished, so a second run talked to the old app; it now runs the app in its own process group and refuses a busy port. | |
| O3 | Health and readiness | `GET /api/health` (liveness) and `GET /api/ready` (database plus attachment store; 503 otherwise, no details). Both are public by design and pinned in the route policy. | `http/hardening.test.ts` |
| O4 | Migration runbook and deployment | DEPLOY.md: database accounts, configuration, systemd unit, nginx with headers and CSP, first install, upgrade and rollback steps. | DEPLOY.md |
| O5 | Error monitoring | Unexpected errors are logged and passed to registered reporters (`addErrorReporter`; a failing reporter is ignored). Uncaught exceptions and unhandled rejections are reported, then the process exits for the supervisor to restart. | `errors/monitoring.ts`, `http/hardening.test.ts` |
