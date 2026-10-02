# PERFORMANCE

Measured on MariaDB 10.11 in the development container (single node, default settings). Chunk 18 adds load tests and p95 targets for every hot path; this file starts with the dashboard (Chunk 12).

## Dashboard (`GET /api/dashboard`)

Two queries, one per widget (`backend/src/repositories/dashboard.ts`):
- **Project table:** one row per live project the caller may see, with `budget` and `actual` from correlated sums.
- **Headline:** `COUNT` and `SUM` over that same project query, so the two widgets cannot disagree.

### Timings (query only, median of 7)

| Dataset | All projects (admin) | Half the projects (member) |
|---|---|---|
| 100 projects x 32 heads x 5,000 expenses (pack target) | 6-7 ms | 4 ms |
| 100 projects x 32 heads x 500,000 expenses (100x) | 130 ms | 63 ms |

Through the full HTTP stack (auth, session, JSON) on the pack's dataset, the median is well under the 300 ms target. This is checked by a test: `dashboard performance` in `backend/src/routes/dashboard.test.ts`.

### EXPLAIN (project table, member scope)

| id | select_type | table | type | key | rows | Extra |
|---|---|---|---|---|---|---|
| 1 | PRIMARY | m (project_members) | ref | ix_project_members_user | 50 | Using where; Using index; Using filesort |
| 1 | PRIMARY | p (projects) | eq_ref | PRIMARY | 1 | Using where |
| 3 | DEPENDENT SUBQUERY | x (expenses) | ref | **ix_expenses_project_actual** | 45 | Using where; **Using index** |
| 3 | DEPENDENT SUBQUERY | h (cost_heads) | ALL | | 32 | Using where |
| 2 | DEPENDENT SUBQUERY | e (project_estimates) | ref | PRIMARY | 16 | |
| 2 | DEPENDENT SUBQUERY | h (cost_heads) | eq_ref | PRIMARY | 1 | Using where |

### Notes

- **First version:** derived tables (`GROUP BY project_id` over all expenses, then joined). It was 11 ms at 5,000 expenses but **6.0 s at 500,000**. The optimiser started from `cost_heads` and walked every expense through `ix_expenses_cost_head`, before any project filter, so even a member with two projects paid for the whole table.
- **Fix:**
  - New covering index `ix_expenses_project_actual (project_id, reversal_of, reversed_at, cost_head_id, amount_fils)`, migration 0011.
  - Per-project correlated sums.
  - Now only the visible projects' index entries are read, without touching table rows ("Using index"), and member-scoped queries cost about half of all-projects.
- **Same index elsewhere:** it also serves `actualsByHead` (BoQ, cost-head detail, projection), which filters on the same columns plus `cost_head_id`.
- **`cost_heads` (32 rows) is scanned per project** for the deleted-head check. That is negligible at this size. If the master grows into the thousands, swap the join order or drop the check (heads are never deleted, D18).
- **Estimates** use their clustered primary key `(project_id, cost_head_id)`.

## Lists and global search (Chunk 13)

Dataset: 100 projects x 32 heads x 100,000 expenses. Query only, median of 7.

| Path | Time | Plan |
|---|---|---|
| Global search, member (50 projects) | 137 ms | `project_members` by user, then `ix_expenses_project_date` per visible project |
| Global search, admin (all projects) | 207 ms | same, every project |
| Expense list, one project, default date sort, page 1 | 12 ms | `ix_expenses_project_date` gives the order, no filesort |
| Expense list, one project, sorted by amount | 8 ms | index range on `project_id`, small sort |

### Notes

- **Search matches "contains"** (`LIKE '%text%'`), which no B-tree index can seek. Every expense path therefore leads with `project_id`, so a search reads only the visible projects' entries. Full-text engines are out of scope for V1. If global search grows slow, the cheap step is prefix matching on codes and invoice numbers (`LIKE 'text%'` seeks `ix_expenses_project_invoice`).
- **Migration 0012** adds `ix_expenses_project_invoice`, `ix_expenses_project_date` and `ix_projects_name`. A test checks that every search, filter and sort path has an index leading with its columns.

## Load test: p95 latencies (Chunk 18)

Dataset: 100 projects x 32 heads x 5,000 expenses (the pack's). Each endpoint 100 times (reverse 50) at **concurrency 10**, through the full stack: auth, session lookup, guards, JSON. The test database pool has 4 connections, so these figures include queueing. Run it with `LOAD_REPORT=<file> npx vitest run src/routes/load.test.ts` (backend), which also fails if a target is missed. **Targets: reads p95 <= 300 ms, writes p95 <= 500 ms. All met.**

| Endpoint | p50 ms | p95 ms | max ms |
|---|---|---|---|
| GET /api/dashboard (admin, 100 projects) | 110 | 134 | 144 |
| GET /api/dashboard (member, 50 projects) | 60 | 74 | 92 |
| GET /api/projects?q=&sort=name | 15 | 22 | 24 |
| GET /api/projects/:id/boq | 16 | 20 | 23 |
| GET /api/projects/:id/boq?order=attention | 15 | 55 | 63 |
| GET /api/projects/:id/cost-heads/:id | 16 | 20 | 26 |
| GET /api/projects/:id/expenses?sort=amount | 14 | 17 | 20 |
| GET .../projection?amountFils= | 13 | 16 | 16 |
| GET /api/search?q=INV-1 (member) | 27 | 33 | 43 |
| GET /api/search?q=INV-1 (admin) | 24 | 32 | 43 |
| POST /api/projects/:id/expenses | 19 | 26 | 36 |
| POST .../expenses/:id/reverse | 22 | 27 | 33 |
| PUT /api/projects/:id/estimates (1 head) | 28 | 33 | 40 |

### Notes

- **Slowest read: the all-projects dashboard (134 ms p95)**, because it sums every project. It grows with the number of projects a user can see. Past a few hundred projects, cache the totals or use summary tables (not needed for V1).
- **Every hot query was EXPLAINed** (sections above). Each one reads through an index that leads with `project_id` or the primary key. No missing indexes were found in this chunk: migrations 0011 and 0012 already added them.
