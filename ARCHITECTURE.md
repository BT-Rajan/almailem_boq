# ARCHITECTURE (proposed)

## Layout
```
almailem_boq/
  CLAUDE.md  DECISIONS.md  DOMAIN.md  ARCHITECTURE.md
  docs/PROMPT_PACK.md
  shared/                  # zod schemas, types, money helpers (the only place types are defined)
  backend/
    src/
      auth/                # config, passwords (argon2id), tokens, rate-limit, auth-service (login/resolve/logout),
                           # guards (authenticate, authorize, authorizeProjectAccess), routes, plugin (deny-by-default)
      audit/               # recordAudit(): the only writer to audit_log, with secret redaction
      attachments/         # bill files: type sniffing, random-name storage outside any served dir
      domain/
        project-status.ts  # allowed project status transitions - pure
        metrics.ts         # budgetMetrics({budget, actual}), totalMetrics - pure, no I/O, no thresholds
        control/           # calculateBudgetStatus, projectedStatus - pure, owns thresholds
        kpi/               # Chunk 14, built on metrics + control
      db/                  # pool, migrator, seed loader, CLI, SQL helpers (DB tooling)
      repositories/        # the ONLY place SQL lives (with db/); one thin repository per table
      services/            # orchestration, transactions (user-admin: users, roles, project access)
      cli/                 # operator tools (bootstrap-admin)
      routes/              # thin HTTP layer: validate > authorize > service
      query/               # shared search/filter/sort/pagination builder (Chunk 13)
      import/              # parser > validator > mapper > committer (isolated, Chunk 15)
      notify/              # notify() single entry point
  frontend/
    src/ pages/ components/ api/    # no business logic, no formulas
  database/
    migrations/  seed/              # plain SQL up/down files; seed data files (never app code)
  tests/                   # cross-layer contract tests (workspace package @boq/tests)
```

## Dependency rules
- `routes` > `services` > `repositories`; `services` call `domain/*`; `domain/*` imports nothing but `shared`.
- `frontend` talks to the API only and never recomputes metrics or status.
- `import/` may import from `domain`; nothing imports from `import/`.
- Every approval and report path consumes `domain/control` and `domain/metrics`; no duplicate thresholds or formulas.

## Request flow
`route` validates input with the shared schema > `authenticate` > `authorize(permission)` > `authorizeProjectAccess` > `service` (transaction) > `repository` (parameterised SQL) > response envelope `{ok, data, error}` > `recordAudit()` on business events.

## Data flow for the core number
`repository: actual per head = SUM(non-reversed, approved expenses)` > `budgetMetrics` > `calculateBudgetStatus(utilisation, thresholds)` > API > UI status dot.
