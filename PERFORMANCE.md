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
