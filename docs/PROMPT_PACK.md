# Almailem BoQ Manager: Claude Code prompt pack

Oct 1, 2026 · @BT

One copy-paste prompt per chunk, each with a narrow scope, acceptance tests and a hard stop, so Claude Code never builds ahead.

## What changed from the draft plan

The sequence stays at 19 chunks, but each one now has a stricter prompt and a few gaps are closed.

- **Stack is decided in Chunk 00, not assumed.** The draft said TypeScript throughout; Chunk 00 now records the real stack in DECISIONS.md and every later prompt reads it from there.
- **Money is integer minor units.** KWD has 3 decimals, so amounts are stored as integer fils, never floats. This is set in Chunk 01 and used everywhere.
- **Thresholds are data, not code.** The 80% and 100% limits live in one config row (editable in Admin > Approval Rules), consumed only by the control engine.
- **Committed amount is deferred.** The cost-head detail mockup shows Committed; V1 has no POs, so the field is left out until a purchase module exists.
- **Dependency order fixed.** The audit trail (old Chunk 16) is now a thin `recordAudit()` helper from Chunk 03, called by later chunks; Chunk 16 only adds the viewer and fills gaps.
- **Each prompt ends with a STOP line and a report format**, and names the files it may touch.
- **UI rules from the design brief are enforced per chunk**: minimal, dense tables, status dots, Budget > Actual > Remaining > % Used visible everywhere, no charts hiding numbers.

## Master rules (paste into CLAUDE.md once)

Put this in the repo's CLAUDE.md in Chunk 00 so it applies to every session. Each chunk prompt below then only carries what is specific to it.

```text
PROJECT: Almailem BoQ Manager. Budget control for construction projects:
Project > Cost Heads (32) > Estimate > Expense > Budget status > Approval.

STANDING RULES
1. One responsibility per module. Business rules live in one place only.
2. No duplicated calculations across API, UI, reports or dashboard.
   All budget maths comes from domain/metrics; all thresholds from domain/control.
3. No business logic in UI components. No DB queries outside repositories.
4. Shared types/schemas are defined once in shared/ and imported everywhere.
5. Money = integer minor units (KWD fils), never floats. Format only at the UI edge.
6. Authorization goes through authorize(permission) and authorizeProjectAccess(projectId). Never inline role checks.
7. Validate every API input with the shared schema. Never trust the client.
8. Parameterised queries only. No string-built SQL. No secrets in code or logs.
9. Do not build future features. Do not touch unrelated modules.
10. Prefer small plain functions over clever abstractions. Refactor at the first repetition.
11. Target: V1 stays under about 35K LOC.
12. Every chunk ends with tests, lint and build passing, then STOP.

UI RULES
Minimal, dense, light neutral background (#F8F9FA), white panels, thin borders,
small radius, no heavy shadows, one brand accent, Inter-style sans-serif.
Compact tables. Status dots only: Normal (0-79%), Warning (80-99%), Approval (>=100%).
Budget > Actual > Remaining > % Used > Action must be visible wherever money appears.
No charts that hide numbers.

REPORT FORMAT (every chunk)
1. Files created   2. Files changed   3. Tests added   4. Test/lint/build results
5. Architectural concerns or deviations   6. Anything you deliberately did NOT build
```

### Per-chunk prompt shape

Every prompt below follows the same skeleton: **Context, Objective, Scope (allowed files), Tasks, Acceptance, Out of scope, Stop**. Review the report and commit before pasting the next prompt.

## Stage 1: Foundation (chunks 00-06)

Result: a clean app with users, permissions, projects and a managed cost-head master.

### Chunk 00: Reconnaissance

```text
CONTEXT: Almailem BoQ Manager, new build. Read the attached BoQ workbook and any existing repo.
OBJECTIVE: Understand the source data and agree the domain model. Write NO application code.
TASKS
- Inspect repo, package manager, framework, DB setup, conventions (if any exist).
- Analyse every sheet of the BoQ workbook: headers, units, currency, the cost-head structure,
  hierarchy, merged cells, formulas, oddities. List the cost heads as found, do not invent any.
- Write ARCHITECTURE.md (proposed stack and folder layout), DOMAIN.md (entities, relationships,
  glossary, money and threshold rules), DECISIONS.md (stack choice with reasons, money as integer fils,
  soft-delete policy, auth approach). Add the Master rules to CLAUDE.md.
- Include the mapping Workbook > Project > Cost Head > Estimate > Expense > Approval, and a table
  of workbook columns to domain fields.
ACCEPTANCE: the three docs exist; every workbook sheet is accounted for; open questions are listed.
OUT OF SCOPE: any code, schema, UI, or inventing cost heads.
STOP after the report. Wait for my review of the domain model.
```

### Chunk 01: Application skeleton

```text
CONTEXT: Chunk 00 is approved; follow DECISIONS.md for the stack.
OBJECTIVE: Create the empty skeleton only.
SCOPE: frontend/ backend/ database/ shared/ tests/ and root config.
TASKS
- Strict type checking (or the stack's equivalent), linting, formatting, env config with a validated
  schema and a .env.example, central error type and error handler, structured logger (no PII or
  secrets), API response envelope {ok, data, error}, shared money helpers (integer fils in/out,
  one formatter), test framework, one health endpoint and one smoke test per layer.
- Scripts: test, lint, build, dev.
ACCEPTANCE: test, lint and build all pass from a clean checkout; health endpoint returns the envelope;
  money helper tests cover rounding and formatting; no business features exist.
OUT OF SCOPE: database tables, auth, any screens beyond a blank shell.
STOP after the report.
```

### Chunk 02: Database foundation

```text
CONTEXT: Skeleton passes. Schema must be normalised and minimal.
OBJECTIVE: Core identity and domain tables plus migration tooling.
SCOPE: database/ and the repository layer for these tables only.
TASKS
- Migrations for: users, roles, permissions, role_permissions, user_roles, projects,
  project_members, cost_heads, audit_log (append-only, business events).
- Every table: UUID or equivalent id, created_at, updated_at, foreign keys, indexes on every FK and
  on lookup columns. Soft-delete (deleted_at) only on users, projects and cost_heads.
- Seed script: system roles (Admin, Project Manager, Accountant, Viewer) and the permission list
  from DOMAIN.md. Do NOT seed cost heads.
- Thin repositories per table; no queries elsewhere.
ACCEPTANCE: migrate from an empty DB to the full schema, and roll back, cleanly; constraint tests
  prove FK and uniqueness rules (project code, user email, cost head code); seed is idempotent.
OUT OF SCOPE: estimates, expenses, approvals, notifications, any API routes.
STOP after the report.
```

### Chunk 03: Authentication and authorization

```text
CONTEXT: Schema from Chunk 02 exists.
OBJECTIVE: Login, session, current user, centralised authorization, audit helper.
SCOPE: backend/auth, backend/audit, shared auth types.
TASKS
- Login, logout, current-user endpoints. Passwords hashed with a modern memory-hard algorithm
  (argon2id or bcrypt per DECISIONS.md). Secure, HttpOnly, SameSite session cookies or short-lived
  tokens with rotation; rate-limit and lock out repeated failed logins; generic error messages.
- Middleware authenticate(); guards authorize(permission) and authorizeProjectAccess(projectId).
  No other place may compare role names.
- recordAudit(event, actor, entity, before, after): append-only helper, no UI yet.
- CSRF protection if cookies are used. Disabled users cannot log in or keep sessions.
ACCEPTANCE: tests for unauthenticated 401, forbidden 403, correct 200, wrong project access 403,
  disabled-user rejection, lockout, and that no route performs its own role check.
OUT OF SCOPE: user-management UI, password reset email, SSO.
STOP after the report.
```

### Chunk 04: Admin for users and permissions

```text
CONTEXT: Auth guards work.
OBJECTIVE: Admin can manage users, roles and project access.
SCOPE: backend admin routes + services, frontend Administration > Users and Roles pages.
TASKS
- API and simple UI: create user, disable/enable, assign role, grant and revoke project access,
  list roles with their permissions. All guarded by authorize('admin.users.manage') or similar.
- Every change calls recordAudit(). Prevent removing the last Admin.
- UI: dense table with search, one slide-over form, no wizard. Follow UI RULES.
ACCEPTANCE: create user > assign role > grant project > that user sees only the permitted
  projects (API test); revoked access takes effect on the next request; audit rows written.
OUT OF SCOPE: projects CRUD, cost heads, custom role editor beyond assigning existing roles.
STOP after the report.
```

### Chunk 05: Cost Head Master

```text
CONTEXT: cost_heads table exists. No cost-head names may appear in code.
OBJECTIVE: Admin-managed master list of cost heads.
SCOPE: cost-head service, routes, Administration > Cost Heads page.
TASKS
- Fields: id, code, name, description, display_order, active. CRUD, reorder, deactivate (never hard
  delete a head already referenced by an estimate or expense).
- Seed script that loads the heads FROM the approved workbook mapping (a data file in database/seed/,
  not in application code).
- Frontend consumes the list via the API only.
ACCEPTANCE: admin can add, edit, reorder, deactivate; duplicate code rejected; non-admin 403;
  grep proves no cost-head name literals in frontend/ or backend/ source.
OUT OF SCOPE: per-project estimates, budgets.
STOP after the report.
```

### Chunk 06: Project management

```text
CONTEXT: Users, access and the cost-head master exist.
OBJECTIVE: Project CRUD and members. No money.
SCOPE: project service/routes, Projects list, Create/Edit, Detail shell, Members tab.
TASKS
- Fields: code (unique), name, owner, start/end dates, status, description. Date validation
  (end after start). Status transitions defined in one place.
- List shows only projects the user may access, with search and pagination.
- Create Project is step 1 only of the future 3-step flow (Details); leave a clearly named seam
  for BoQ and Review steps. Add and remove members. recordAudit() on create/edit/status change.
ACCEPTANCE: full CRUD with access control; non-members get 403/404 consistently; list pagination
  tested; no financial fields or calculations on the project object.
OUT OF SCOPE: estimates, budgets, expenses, dashboard.
STOP after the report. Stage 1 complete: tag the repo.
```

## Stage 2: Core financial engine (chunks 07-11)

Result: Estimates > Expenses > Actuals > 80% alert > 100% approval, all from single calculation modules.

### Chunk 07: Project BoQ and estimates

```text
CONTEXT: Projects and the cost-head master exist.
OBJECTIVE: Per-project estimates per cost head, and the one metrics module.
SCOPE: estimates table + repo + service, domain/metrics, Create Project steps 2-3, Project BoQ table.
TASKS
- Table project_estimates(project_id, cost_head_id, amount_fils), unique per pair. Changing an
  estimate is audited with before/after.
- domain/metrics: ONE pure module exposing budgetMetrics({budget, actual}) returning
  {budget, actual, remaining, utilisation}. Utilisation as a ratio with defined behaviour for
  budget = 0. Pure functions, zero I/O, no thresholds here.
- API returns metrics computed by this module only; the frontend never recomputes.
- UI: Create Project steps 2 (estimate per head, running TOTAL) and 3 (review). Project page table:
  Head, Budget, Actual, Remaining, Used, Status (status column stays empty until Chunk 09).
ACCEPTANCE: unit tests for metrics including zero budget, zero actual, actual > budget, large
  fils values; grep proves no budget formula outside domain/metrics; totals equal the sum of heads.
OUT OF SCOPE: expenses, thresholds, approvals.
STOP after the report.
```

### Chunk 08: Expenses and bills

```text
CONTEXT: Estimates and budgetMetrics exist.
OBJECTIVE: Record actual expenditure and feed it into metrics.
SCOPE: expenses table + repo + service + routes, attachment storage, Add Expense form, Cost-head detail.
TASKS
- Fields: project, cost head, vendor, invoice number, date, amount_fils, description, attachment,
  created_by, reversed_at/reversal_of. Delete means reverse: a negative entry linked to the original,
  never a hard delete. Unique (project, vendor, invoice number) to block duplicates.
- Actual per head = sum of non-reversed expenses, computed in the repository query, then passed
  to budgetMetrics. Edit and reverse are audited.
- Attachments: allow-list of types (PDF, JPG, PNG), size cap, random server-side names, stored
  outside the web root, served only through an authorised endpoint, content-type verified.
- UI: the short Add Expense form from the design brief; cost-head detail with the expense list.
ACCEPTANCE: add expense > Actual, Remaining and Used change; reverse restores them; duplicate
  invoice rejected; bad file type rejected; user without project access cannot read attachments;
  concurrent adds produce a correct total (test).
OUT OF SCOPE: thresholds, warnings, approval, notifications.
STOP after the report.
```

### Chunk 09: Budget control engine

```text
CONTEXT: Metrics and expenses work. This is the heart of the system.
OBJECTIVE: One pure module that turns metrics into a status.
SCOPE: domain/control, threshold config, status display only.
TASKS
- calculateBudgetStatus(utilisation, thresholds) returns NORMAL | WARNING | APPROVAL_REQUIRED.
  Defaults: warning at 80%, approval at 100%. Thresholds come from one config source, never
  literals in other files. Integer or exact-decimal comparison, no float drift.
- projectedStatus(currentActual, newAmount, budget): what the status WOULD be after an expense,
  used by the Add Expense form to show the alert before submit.
- Wire status dots into the project table, cost-head detail and Add Expense preview.
ACCEPTANCE: boundary tests at 79.99, 80.00, 99.99, 100.00, 100.01 percent; zero-budget case;
  negative (reversal) case; grep proves the numbers 80 and 100 appear only in config and tests.
  This must be the most heavily tested module in the repo.
OUT OF SCOPE: creating approval records, notifications, blocking submission.
STOP after the report.
```

### Chunk 10: Approval workflow

```text
CONTEXT: The control engine exists. Approvals must CONSUME it, never recompute thresholds.
OBJECTIVE: Block over-budget spend until an Admin decides.
SCOPE: approvals + approval_actions tables, service, routes, Approvals page, Add Expense hook.
TASKS
- When projectedStatus is APPROVAL_REQUIRED, the expense is saved as pending (not counted in
  Actual) and an approval request is created with the mandatory reason. WARNING needs no approval.
- Admin approve/reject with comment. Approve promotes the expense into Actual atomically in one
  transaction; reject keeps it out. Requester cannot approve their own request.
- State machine in one file: PENDING > APPROVED | REJECTED | CANCELLED, no other transitions.
  Every action is a row in approval_actions and an audit event.
- Re-evaluate at approval time (budget may have changed) using the control engine.
- Approvals page: dense table of pending items with project, head, amount, projected %, reason.
ACCEPTANCE: under budget flows normally; crossing 100% creates a request; approve and reject both
  tested; double-approve is rejected; self-approval blocked; non-admin 403; Actual only changes
  on approval.
OUT OF SCOPE: notifications, email, multi-level approval chains.
STOP after the report.
```

### Chunk 11: Notifications

```text
CONTEXT: Warning and approval events now exist.
OBJECTIVE: In-app notifications only, behind one notify() function.
SCOPE: notifications table + repo + service, bell menu, unread count.
TASKS
- Events: 80% warning (to project admins), approval required (to Admins), approved and rejected
  (to requester). notify(type, recipients, payload) is the single entry point called by the
  existing services; no other code inserts notifications.
- List, mark read, mark all read, cursor pagination. Users read only their own.
- De-duplicate: one warning per head per threshold crossing, not one per expense.
ACCEPTANCE: each of the four events creates the right rows for the right users; duplicates
  suppressed; users cannot read others' notifications; delivery can later be extended (email)
  without touching financial code, shown by the notify() seam.
OUT OF SCOPE: email, push, preferences UI.
STOP after the report. Stage 2 complete: tag the repo.
```

## Stage 3: Management layer (chunks 12-16)

Result: dashboard, search, KPIs, reports, Excel import and an audit viewer, all reading the same engines.

### Chunk 12: Project dashboard

```text
CONTEXT: Data and engines are correct.
OBJECTIVE: Home dashboard and project summary that answer "where is the money going and where do I act?"
SCOPE: dashboard API (aggregation only) + two screens. No new calculations.
TASKS
- Dashboard: Projects, Budget, Actual, Pending approvals as four plain figures, then a dense
  project table (Project, Budget, Actual, Used, Status). Only projects the user may access.
- Project page header: Budget, Actual, Remaining, % used, then the cost-head table with warning
  and over-budget heads sorted to the top option. All figures from budgetMetrics and
  calculateBudgetStatus.
- Aggregations done in SQL, one query per widget; add indexes if needed and show EXPLAIN notes.
ACCEPTANCE: dashboard totals equal the sum of project totals (test); status dots match the engine;
  no formula in frontend; loads under 300 ms on a seeded dataset of 100 projects x 32 heads
  x 5,000 expenses.
OUT OF SCOPE: charts, trends, exports.
STOP after the report.
```

### Chunk 13: Search

```text
CONTEXT: Lists exist in several pages with ad-hoc filtering.
OBJECTIVE: One reusable search/filter/sort/pagination pattern, then adopt it.
SCOPE: backend/query (shared builder), one frontend table hook/component, adoption in lists.
TASKS
- A single query builder with an allow-list of sortable and filterable fields per entity
  (project, cost head, expense, invoice, vendor). Parameterised, with max page size and
  stable cursor or offset pagination.
- One global search box (Project, Cost head, Invoice, Vendor, Expense) returning grouped results,
  already filtered by project access.
- Replace the per-page filtering from earlier chunks with the shared pattern; delete the old code.
ACCEPTANCE: access filtering tested; injection attempts in sort/filter params rejected; indexes
  support each search path; net lines of code decrease after adoption.
OUT OF SCOPE: full-text engines, saved searches.
STOP after the report.
```

### Chunk 14: Reports and KPI engine

```text
CONTEXT: Metrics and control engines exist.
OBJECTIVE: One KPI module feeding dashboard, reports and project summary.
SCOPE: domain/kpi, report service, Reports page, export.
TASKS
- domain/kpi defines: Budget Utilisation, Actual Spend, Remaining Budget, Budget Variance,
  Warning Heads, Over-budget Heads, Pending Approvals. Built on budgetMetrics and
  calculateBudgetStatus. Refactor the Chunk 12 dashboard to consume it.
- Reports page: filters Project, Period, Cost Head; Budget vs Actual table with Variance column.
- Export to Excel and PDF from the same report data object (one source, two renderers).
  Sanitise cell values that begin with =, +, - or @ to prevent formula injection.
ACCEPTANCE: dashboard, report and export show identical numbers for the same filter (test);
  KPI unit tests with edge cases; exports open correctly; access control applied to every report.
OUT OF SCOPE: custom report builder, scheduling, email delivery.
STOP after the report.
```

### Chunk 15: Excel import

```text
CONTEXT: The domain model is stable. Excel quirks must not leak into it.
OBJECTIVE: Isolated import pipeline: Preview > Validate > Import > Error report.
SCOPE: backend/import (parser, validator, mapper, committer), Import wizard UI.
TASKS
- Parser reads the workbook into a neutral row structure. Validator checks required columns,
  numeric amounts, unknown cost heads, duplicates, negatives. Mapper maps rows to cost_heads and
  estimates using the mapping approved in Chunk 00.
- Preview screen shows what will change and every error with sheet, row and column. Commit runs in
  ONE transaction, all-or-nothing, and is audited. Dry-run is the default.
- Safe parsing: size and row limits, reject macros and external links, never evaluate formulas,
  read cached values only, treat files as untrusted.
ACCEPTANCE: the real Almailem workbook previews with zero unexplained errors; a deliberately
  broken workbook produces a precise error report and imports nothing; re-import is idempotent;
  the import module imports from the domain but nothing imports from it.
OUT OF SCOPE: expense import, scheduled imports.
STOP after the report.
```

### Chunk 16: Audit trail viewer

```text
CONTEXT: recordAudit() has been called since Chunk 03.
OBJECTIVE: Verify coverage of business events and add the Admin viewer.
SCOPE: audit coverage review, Administration > Audit Log page.
TASKS
- Audit the code for the event list: project created, estimate changed, expense created/changed/
  reversed, approval requested/approved/rejected, user permission changed. Add any missing call.
- Viewer: filter by actor, entity, event, date range; before/after diff; pagination via the
  shared pattern from Chunk 13. Read-only; the audit table has no update or delete path.
- Do NOT audit harmless UI interactions.
ACCEPTANCE: a test per event proves one audit row with actor, timestamp and before/after;
  non-admin 403; audit rows cannot be modified through any service.
OUT OF SCOPE: external log shipping, retention policies.
STOP after the report. Stage 3 complete: tag the repo.
```

## Stage 4: Productization (chunks 17-18)

Result: a comfortable iPad experience and a hardened, deployable system.

### Chunk 17: iPad polish

```text
CONTEXT: Functionality is stable and tested.
OBJECTIVE: Make the existing screens work well on iPad. No new features.
SCOPE: CSS/layout and interaction changes in frontend/ only; no backend or domain changes.
TASKS
- Test and fix landscape and portrait. Touch targets at least 44 px. Short forms; Add Expense
  and approval actions as bottom sheets. Wide tables scroll horizontally with a sticky first
  column. Camera capture for invoice upload via the file input capture attribute.
- Priority screens: Project/BoQ table, Add Expense, Approvals. Then dashboard.
- Keep the minimal visual style; no new components that duplicate existing ones.
ACCEPTANCE: checklist verified at 1024x768 and 768x1024 viewports (automated screenshots or
  Playwright checks); no horizontal page scroll; every primary action reachable with one thumb;
  no logic changes (diff shows frontend styling and layout only).
OUT OF SCOPE: native app, offline mode, new screens.
STOP after the report.
```

### Chunk 18: Hardening

```text
CONTEXT: Feature complete. Prepare for UAT.
OBJECTIVE: Security, correctness and performance pass. Fix findings, add tests, do not add features.
TASKS
- Security: authz matrix test (every route x every role x member/non-member); input validation
  review; security headers and CSP; CORS allow-list; dependency audit; secrets scan; verify
  session settings, lockout, attachment handling and Excel import limits; rate limits on auth
  and uploads; no sensitive data in logs.
- Financial correctness: property-based tests that Actual = sum of approved, non-reversed
  expenses, and that dashboard, report and export always agree; rounding and boundary tests
  re-run.
- Concurrency: simultaneous expenses and approvals on the same head, using row locks or
  serialisable transactions; test for double-approval.
- Performance: EXPLAIN every hot query, add missing indexes, load test on the seeded dataset,
  record p95 latencies in a PERFORMANCE.md.
- Operations: backup and restore script with a tested restore, migration runbook, health and
  readiness endpoints, deployment steps in DEPLOY.md, error monitoring hooks.
ACCEPTANCE: authz matrix passes; no high or critical dependency findings; backup restores to a
  working app; p95 targets met; HARDENING.md lists each finding, fix and any accepted risk.
OUT OF SCOPE: new features.
STOP after the report. Begin UAT with Almailem users.
```

### Working rhythm

1. Paste one prompt. Let Claude Code finish and report.
2. Review the diff and the report, run test, lint and build yourself, and check the grep-style acceptance items.
3. Commit and tag at stage boundaries. Fix issues in the same chunk before moving on.
4. If Claude Code proposes something outside scope, answer "note it in DECISIONS.md and stop".
