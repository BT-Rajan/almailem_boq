import { fils, type Fils } from '@boq/shared';
import type { Db } from '../db/pool';
import { exec, selectRows, type Row } from '../db/sql';
import { guarded } from '../db/errors';
import { str } from './shared';

/** amount_fils is BIGINT; the driver gives a number when safe, a string when not (rejected by fils()). */
const toFils = (r: Row): Fils => fils(Number(r['amount_fils']));

const byHead = (rows: Row[]): Map<string, Fils> =>
  new Map(rows.map((r) => [str(r, 'cost_head_id'), toFils(r)]));

export function estimatesRepository(db: Db) {
  return {
    /** Budget per cost head for one project. Heads without a row have no budget (0). */
    async listForProject(projectId: string): Promise<Map<string, Fils>> {
      return byHead(
        await selectRows(
          db,
          'SELECT cost_head_id, amount_fils FROM project_estimates WHERE project_id = ?',
          [projectId],
        ),
      );
    },
    async upsert(projectId: string, costHeadId: string, amount: Fils): Promise<void> {
      await guarded('Estimate', () =>
        exec(
          db,
          `INSERT INTO project_estimates (project_id, cost_head_id, amount_fils) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE amount_fils = VALUES(amount_fils)`,
          [projectId, costHeadId, amount],
        ),
      );
    },
  };
}
