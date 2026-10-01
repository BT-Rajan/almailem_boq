import { guarded } from '../db/errors';
import type { Db } from '../db/pool';
import { exec, selectOne, selectRows, type Row } from '../db/sql';
import {
  buildSet,
  liveClause,
  str,
  strOrNull,
  toBool,
  toDate,
  toDateOrNull,
  type FindOptions,
  type Timestamps,
} from './shared';

export type CostHeadRecord = Timestamps & {
  id: string;
  code: string;
  name: string;
  description: string | null;
  displayOrder: number;
  active: boolean;
  deletedAt: Date | null;
};
export type NewCostHead = {
  code: string;
  name: string;
  description?: string | null;
  displayOrder?: number;
  active?: boolean;
};
export type CostHeadPatch = {
  name?: string;
  description?: string | null;
  displayOrder?: number;
  active?: boolean;
};

const map = (r: Row): CostHeadRecord => ({
  id: str(r, 'id'),
  code: str(r, 'code'),
  name: str(r, 'name'),
  description: strOrNull(r, 'description'),
  displayOrder: Number(r['display_order']),
  active: toBool(r['active']),
  deletedAt: toDateOrNull(r['deleted_at']),
  createdAt: toDate(r['created_at']),
  updatedAt: toDate(r['updated_at']),
});

const COLUMNS = {
  name: 'name',
  description: 'description',
  displayOrder: 'display_order',
  active: 'active',
};

export function costHeadsRepository(db: Db) {
  return {
    async create(input: NewCostHead): Promise<CostHeadRecord> {
      return guarded('Cost head', async () => {
        const row = await selectOne(
          db,
          `INSERT INTO cost_heads (code, name, description, display_order, active)
           VALUES (?, ?, ?, ?, ?) RETURNING *`,
          [
            input.code,
            input.name,
            input.description ?? null,
            input.displayOrder ?? 0,
            input.active === false ? 0 : 1,
          ],
        );
        return map(row as Row);
      });
    },
    async findById(id: string, opts?: FindOptions): Promise<CostHeadRecord | null> {
      const row = await selectOne(db, `SELECT * FROM cost_heads WHERE id = ?${liveClause(opts)}`, [
        id,
      ]);
      return row ? map(row) : null;
    },
    async findByCode(code: string, opts?: FindOptions): Promise<CostHeadRecord | null> {
      const row = await selectOne(
        db,
        `SELECT * FROM cost_heads WHERE code = ?${liveClause(opts)}`,
        [code],
      );
      return row ? map(row) : null;
    },
    /** Live heads in display order. Inactive heads are included only on request. */
    async list(opts: { includeInactive?: boolean } = {}): Promise<CostHeadRecord[]> {
      const rows = await selectRows(
        db,
        `SELECT * FROM cost_heads WHERE deleted_at IS NULL${opts.includeInactive ? '' : ' AND active = 1'}
         ORDER BY display_order, code`,
      );
      return rows.map(map);
    },
    async update(id: string, patch: CostHeadPatch): Promise<boolean> {
      const set = buildSet(patch, COLUMNS);
      if (!set) return false;
      const res = await exec(
        db,
        `UPDATE cost_heads SET ${set.sql} WHERE id = ? AND deleted_at IS NULL`,
        [...set.params, id],
      );
      return res.affectedRows > 0;
    },
    async softDelete(id: string): Promise<boolean> {
      const res = await exec(
        db,
        'UPDATE cost_heads SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND deleted_at IS NULL',
        [id],
      );
      return res.affectedRows > 0;
    },
  };
}
