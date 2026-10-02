import type { ProjectRef } from '@boq/shared';
import { guarded } from '../db/errors';
import type { Db } from '../db/pool';
import { exec, selectOne, selectRows, type Row } from '../db/sql';
import {
  buildSet,
  containsPattern,
  liveClause,
  str,
  strOrNull,
  toDate,
  toDateOrNull,
  type FindOptions,
  type Timestamps,
} from './shared';

/** No financial fields on a project, by design (budgets live on estimates, from Chunk 07). */
export type ProjectRecord = Timestamps & {
  id: string;
  code: string;
  name: string;
  ownerUserId: string;
  startDate: string | null; // 'YYYY-MM-DD'
  endDate: string | null;
  status: string;
  description: string | null;
  deletedAt: Date | null;
};
export type NewProject = {
  code: string;
  name: string;
  ownerUserId: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
};
export type ProjectPatch = Partial<Omit<NewProject, 'code'>>;

const map = (r: Row): ProjectRecord => ({
  id: str(r, 'id'),
  code: str(r, 'code'),
  name: str(r, 'name'),
  ownerUserId: str(r, 'owner_user_id'),
  startDate: strOrNull(r, 'start_date'),
  endDate: strOrNull(r, 'end_date'),
  status: str(r, 'status'),
  description: strOrNull(r, 'description'),
  deletedAt: toDateOrNull(r['deleted_at']),
  createdAt: toDate(r['created_at']),
  updatedAt: toDate(r['updated_at']),
});

const mapRef = (r: Row): ProjectRef => ({
  id: str(r, 'id'),
  code: str(r, 'code'),
  name: str(r, 'name'),
});

const COLUMNS = {
  name: 'name',
  ownerUserId: 'owner_user_id',
  status: 'status',
  startDate: 'start_date',
  endDate: 'end_date',
  description: 'description',
};

export function projectsRepository(db: Db) {
  return {
    async create(input: NewProject): Promise<ProjectRecord> {
      return guarded('Project', async () => {
        const row = await selectOne(
          db,
          `INSERT INTO projects (code, name, owner_user_id, status, start_date, end_date, description)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          [
            input.code,
            input.name,
            input.ownerUserId,
            input.status,
            input.startDate ?? null,
            input.endDate ?? null,
            input.description ?? null,
          ],
        );
        return map(row as Row);
      });
    },
    async findById(id: string, opts?: FindOptions): Promise<ProjectRecord | null> {
      const row = await selectOne(db, `SELECT * FROM projects WHERE id = ?${liveClause(opts)}`, [
        id,
      ]);
      return row ? map(row) : null;
    },
    /**
     * Row-lock a live project until the transaction ends; null if missing or deleted. Serialises
     * changes that hang off the project (budgets) even when they have no rows of their own yet.
     */
    async lockById(id: string): Promise<ProjectRecord | null> {
      const row = await selectOne(
        db,
        'SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [id],
      );
      return row ? map(row) : null;
    },
    /** True when the project exists and is not deleted. */
    async isLive(id: string): Promise<boolean> {
      const row = await selectOne(
        db,
        'SELECT 1 AS found FROM projects WHERE id = ? AND deleted_at IS NULL',
        [id],
      );
      return row !== null;
    },
    async findByCode(code: string, opts?: FindOptions): Promise<ProjectRecord | null> {
      const row = await selectOne(db, `SELECT * FROM projects WHERE code = ?${liveClause(opts)}`, [
        code,
      ]);
      return row ? map(row) : null;
    },
    /** Live projects, by code. For pickers; the full project list arrives with project management. */
    async listRefs(): Promise<ProjectRef[]> {
      const rows = await selectRows(
        db,
        'SELECT id, code, name FROM projects WHERE deleted_at IS NULL ORDER BY code',
      );
      return rows.map(mapRef);
    },
    /** Live projects the user is a member of, by code. */
    async listRefsForMember(userId: string): Promise<ProjectRef[]> {
      const rows = await selectRows(
        db,
        `SELECT p.id, p.code, p.name FROM projects p JOIN project_members m ON m.project_id = p.id
          WHERE m.user_id = ? AND p.deleted_at IS NULL ORDER BY p.code`,
        [userId],
      );
      return rows.map(mapRef);
    },
    /**
     * Live projects with the owner's name, by code. `memberUserId` limits the list to that user's
     * projects; null means every project (the caller decides who may see everything).
     */
    async search(opts: {
      memberUserId: string | null;
      search?: string | undefined;
      limit: number;
      offset: number;
    }): Promise<{ rows: (ProjectRecord & { ownerName: string })[]; total: number }> {
      const where = ['p.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (opts.memberUserId !== null) {
        where.push(
          'EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)',
        );
        params.push(opts.memberUserId);
      }
      if (opts.search) {
        where.push('(p.code LIKE ? OR p.name LIKE ?)');
        params.push(containsPattern(opts.search), containsPattern(opts.search));
      }
      const clause = where.join(' AND ');
      const count = await selectOne(
        db,
        `SELECT COUNT(*) AS n FROM projects p WHERE ${clause}`,
        params,
      );
      const rows = await selectRows(
        db,
        `SELECT p.*, u.name AS owner_name FROM projects p JOIN users u ON u.id = p.owner_user_id
          WHERE ${clause} ORDER BY p.code LIMIT ? OFFSET ?`,
        [...params, opts.limit, opts.offset],
      );
      return {
        rows: rows.map((r) => ({ ...map(r), ownerName: str(r, 'owner_name') })),
        total: Number(count?.['n'] ?? 0),
      };
    },
    async update(id: string, patch: ProjectPatch): Promise<boolean> {
      const set = buildSet(patch, COLUMNS);
      if (!set) return false;
      return guarded('Project', async () => {
        const res = await exec(
          db,
          `UPDATE projects SET ${set.sql} WHERE id = ? AND deleted_at IS NULL`,
          [...set.params, id],
        );
        return res.affectedRows > 0;
      });
    },
    async softDelete(id: string): Promise<boolean> {
      const res = await exec(
        db,
        'UPDATE projects SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND deleted_at IS NULL',
        [id],
      );
      return res.affectedRows > 0;
    },
  };
}
