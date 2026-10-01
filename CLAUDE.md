# CLAUDE.md

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

Per-chunk prompts are in `docs/PROMPT_PACK.md`. Stack and policy decisions are in `DECISIONS.md`; read it before writing code.
