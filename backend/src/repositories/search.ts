import { fils, type SearchHit, type SearchResults } from '@boq/shared';
import type { Db } from '../db/pool';
import { selectRows, type Row } from '../db/sql';
import { andConditions, containsPattern, memberScope } from '../query/list';
import { str, strOrNull } from './shared';

/**
 * Global search: a few hits per group, newest or most relevant first. Project-scoped groups pass
 * through the same member scope as every list. Patterns are bound parameters, never SQL.
 */
const LIMIT = 8;

const hit = (r: Row): SearchHit => ({
  projectId: str(r, 'project_id'),
  projectNo: str(r, 'project_no'),
  costHeadId: str(r, 'cost_head_id'),
  expenseId: str(r, 'id'),
  vendor: str(r, 'vendor'),
  invoiceNo: str(r, 'invoice_no'),
  expenseDate: str(r, 'expense_date'),
  amountFils: fils(Number(r['amount_fils'])),
  description: strOrNull(r, 'description'),
});

export function searchRepository(db: Db) {
  return {
    async search(q: string, memberUserId: string | null): Promise<SearchResults> {
      const like = containsPattern(q);
      const scope = (alias: string) => andConditions(memberScope(alias, memberUserId));
      const p = scope('p.id');
      const x = scope('x.project_id');
      // Expenses of live projects only; reversal entries are records of a correction, not results.
      const expenseFrom = `FROM expenses x JOIN projects p ON p.id = x.project_id AND p.deleted_at IS NULL
        WHERE x.reversal_of IS NULL AND x.deleted_at IS NULL`;
      const expenseCols = 'SELECT x.*, p.system_no AS project_no';

      const [projects, heads, invoices, vendors, expenses] = await Promise.all([
        selectRows(
          db,
          `SELECT p.id, p.system_no, p.name FROM projects p
            WHERE p.deleted_at IS NULL AND (p.system_no LIKE ? OR p.name LIKE ?)${p.sql}
            ORDER BY p.system_no LIMIT ${LIMIT}`,
          [like, like, ...p.params],
        ),
        selectRows(
          db,
          `SELECT id, code, name, active FROM cost_heads
            WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)
            ORDER BY display_order, code LIMIT ${LIMIT}`,
          [like, like],
        ),
        selectRows(
          db,
          `${expenseCols} ${expenseFrom} AND x.invoice_no LIKE ?${x.sql}
            ORDER BY x.expense_date DESC, x.id LIMIT ${LIMIT}`,
          [like, ...x.params],
        ),
        selectRows(
          db,
          `SELECT x.vendor, COUNT(*) AS expenses, COUNT(DISTINCT x.project_id) AS projects
           ${expenseFrom} AND x.vendor LIKE ?${x.sql}
            GROUP BY x.vendor ORDER BY x.vendor LIMIT ${LIMIT}`,
          [like, ...x.params],
        ),
        selectRows(
          db,
          `${expenseCols} ${expenseFrom} AND x.description LIKE ?${x.sql}
            ORDER BY x.expense_date DESC, x.id LIMIT ${LIMIT}`,
          [like, ...x.params],
        ),
      ]);
      return {
        projects: projects.map((r) => ({
          id: str(r, 'id'),
          systemNo: str(r, 'system_no'),
          name: str(r, 'name'),
        })),
        costHeads: heads.map((r) => ({
          id: str(r, 'id'),
          code: str(r, 'code'),
          name: str(r, 'name'),
          active: Number(r['active']) === 1,
        })),
        invoices: invoices.map(hit),
        vendors: vendors.map((r) => ({
          vendor: str(r, 'vendor'),
          expenses: Number(r['expenses']),
          projects: Number(r['projects']),
        })),
        expenses: expenses.map(hit),
      };
    },
  };
}
