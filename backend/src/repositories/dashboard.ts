import { fils, type Fils } from '@boq/shared';
import type { Db } from '../db/pool';
import { selectOne, selectRows, type Row } from '../db/sql';
import { andConditions, memberScope } from '../query/list';
import { countsTowardActual, str } from './shared';

/**
 * Dashboard aggregation, in SQL. Budget per project = sum of its estimates; actual = sum of the
 * expenses that count toward Actual (countsTowardActual, the same rule as the BoQ). The summary widget sums the
 * project table's own query, so the two cannot disagree on what "budget" and "actual" mean.
 */

/**
 * One row per live project with its budget and actual. Correlated sums per project, so only the
 * visible projects' rows are read; actual uses the covering index ix_expenses_project_actual.
 */
const PROJECT_FIGURES = `
  SELECT p.id, p.system_no, p.name, p.status,
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
            WHERE x.project_id = p.id AND ${countsTowardActual('x')}
         ), 0) AS SIGNED) AS actual
    FROM projects p
   WHERE p.deleted_at IS NULL`;

/** BIGINT sums: a number when safe, a string when not, and fils() rejects the latter. */
const money = (v: unknown): Fils => fils(Number(v));

export type ProjectTotalsRow = {
  id: string;
  systemNo: string;
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
      const s = andConditions(memberScope('p.id', memberUserId));
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

    /** Widget 2, the project table: budget and actual per project, by system number. */
    async projectTotals(memberUserId: string | null): Promise<ProjectTotalsRow[]> {
      const s = andConditions(memberScope('p.id', memberUserId));
      const rows = await selectRows(
        db,
        `${PROJECT_FIGURES}${s.sql} ORDER BY p.system_no`,
        s.params,
      );
      return rows.map((r: Row) => ({
        id: str(r, 'id'),
        systemNo: str(r, 'system_no'),
        name: str(r, 'name'),
        status: str(r, 'status'),
        budget: money(r['budget']),
        actual: money(r['actual']),
      }));
    },
  };
}
