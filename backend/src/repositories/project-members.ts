import { guarded, insertIfMissing } from '../db/errors';
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
    /** Idempotent add. True when the user was newly added, false when already a member. */
    async addIfMissing(projectId: string, userId: string): Promise<boolean> {
      return insertIfMissing('Project member', () =>
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
    /**
     * Who belongs to the project: stored members (unless deleted) plus every enabled holder of
     * `implicitPermission`, who belongs to all projects without a row (D17). The one place this is
     * answered; member lists and notification recipients use it.
     */
    async listMembers(
      projectId: string,
      implicitPermission: string,
    ): Promise<{ id: string; name: string; email: string; stored: boolean }[]> {
      const rows = await selectRows(
        db,
        `SELECT u.id, u.name, u.email, MAX(src.stored) AS stored
           FROM (
             SELECT user_id, 1 AS stored FROM project_members WHERE project_id = ?
             UNION ALL
             SELECT ur.user_id, 0 AS stored
               FROM user_roles ur
               JOIN role_permissions rp ON rp.role_id = ur.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE p.code = ?
           ) src
           JOIN users u ON u.id = src.user_id
          WHERE u.deleted_at IS NULL AND (src.stored = 1 OR u.disabled = 0)
          GROUP BY u.id, u.name, u.email
          ORDER BY u.name, u.email`,
        [projectId, implicitPermission],
      );
      return rows.map((r) => ({
        id: String(r['id']),
        name: String(r['name']),
        email: String(r['email']),
        stored: Number(r['stored']) === 1,
      }));
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
