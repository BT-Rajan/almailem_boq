import { guarded } from '../db/errors';
import type { Db } from '../db/pool';
import { exec, selectOne, selectRows } from '../db/sql';

export function projectMembersRepository(db: Db) {
  return {
    async add(projectId: string, userId: string): Promise<void> {
      await guarded('Project member', () =>
        exec(db, 'INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [
          projectId,
          userId,
        ]),
      );
    },
    async remove(projectId: string, userId: string): Promise<boolean> {
      const res = await exec(
        db,
        'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
        [projectId, userId],
      );
      return res.affectedRows > 0;
    },
    async isMember(projectId: string, userId: string): Promise<boolean> {
      const row = await selectOne(
        db,
        'SELECT 1 AS found FROM project_members WHERE project_id = ? AND user_id = ?',
        [projectId, userId],
      );
      return row !== null;
    },
    /** True when the project exists, is not deleted, and the user is one of its members. */
    async hasAccess(projectId: string, userId: string): Promise<boolean> {
      const row = await selectOne(
        db,
        `SELECT 1 AS found FROM project_members m JOIN projects p ON p.id = m.project_id
          WHERE m.project_id = ? AND m.user_id = ? AND p.deleted_at IS NULL`,
        [projectId, userId],
      );
      return row !== null;
    },
    async listUserIds(projectId: string): Promise<string[]> {
      const rows = await selectRows(
        db,
        'SELECT user_id FROM project_members WHERE project_id = ? ORDER BY created_at, user_id',
        [projectId],
      );
      return rows.map((r) => String(r['user_id']));
    },
  };
}
