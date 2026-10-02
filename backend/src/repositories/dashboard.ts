import { fils, type Fils } from '@boq/shared';
import type { Db } from '../db/pool';
import { selectOne, selectRows, type Row } from '../db/sql';
import { str } from './shared';

/**
 * Dashboard aggregation, in SQL. Budget per project = sum of its estimates; actual = sum of its
 * original expenses that are not reversed (the same rules as the BoQ). The summary widget sums the
 * project table's own query, so the two cannot disagree on what "budget" and "actual" mean.
 */

/**
 * One row per live project with its budget and actual. Correlated sums per project, so only the
 * visible projects' rows are read; actual uses the covering index ix_expenses_project_actual.
 */
const PROJECT_FIGURES = `
  SELECT p.id, p.code, p.name, p.status,
         CAST(COALESCE((
           SELECT SUM(e.amount_fils)
             FROM project_estimates e
             JOIN cost_heads h ON h.id = e.cost_head_id AND h.deleted_at IS NULL
            WHERE e.project_id = p.id
         ), 0) AS SIGNED) AS budget,
         CAST(COALESCE((
           SELECT SUM(x.amount_fils)
             FROM expenses x
             JOIN cost_heads h ON h.id = x.cost_head_id AND h.deleted_at IS NULL
            WHERE x.project_id = p.id AND x.reversal_of IS NULL AND x.reversed_at IS NULL
         ), 0) AS SIGNED) AS actual
    FROM projects p
   WHERE p.deleted_at IS NULL`;

/** null = every project; otherwise only projects the user is a member of. */
function scope(memberUserId: string | null): { sql: string; params: unknown[] } {
  return memberUserId === null
    ? { sql: '', params: [] }
    : {
        sql: ' AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)',
        params: [memberUserId],
      };
}

/** BIGINT sums: a number when safe, a string when not, and fils() rejects the latter. */
const money = (v: unknown): Fils => fils(Number(v));

export type ProjectTotalsRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  budget: Fils;
  actual: Fils;
};

export function dashboardRepository(db: Db) {
  return {
    /** Widget 1, the headline: how many projects, and their budget and actual together. */
    async summary(
      memberUserId: string | null,
    ): Promise<{ projects: number; budget: Fils; actual: Fils }> {
      const s = scope(memberUserId);
      const row = await selectOne(
        db,
        `SELECT COUNT(*) AS projects,
                CAST(COALESCE(SUM(t.budget), 0) AS SIGNED) AS budget,
                CAST(COALESCE(SUM(t.actual), 0) AS SIGNED) AS actual
           FROM (${PROJECT_FIGURES}${s.sql}) t`,
        s.params,
      );
      return {
        projects: Number(row?.['projects'] ?? 0),
        budget: money(row?.['budget'] ?? 0),
        actual: money(row?.['actual'] ?? 0),
      };
    },

    /** Widget 2, the project table: budget and actual per project, by code. */
    async projectTotals(memberUserId: string | null): Promise<ProjectTotalsRow[]> {
      const s = scope(memberUserId);
      const rows = await selectRows(db, `${PROJECT_FIGURES}${s.sql} ORDER BY p.code`, s.params);
      return rows.map((r: Row) => ({
        id: str(r, 'id'),
        code: str(r, 'code'),
        name: str(r, 'name'),
        status: str(r, 'status'),
        budget: money(r['budget']),
        actual: money(r['actual']),
      }));
    },
  };
}
