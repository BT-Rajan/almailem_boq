import { guarded } from '../db/errors';
import type { Db } from '../db/pool';
import { exec, selectOne, selectRows, type Row } from '../db/sql';
import { str, strOrNull, toBool, toDate, type Timestamps } from './shared';

export type RoleRecord = Timestamps & {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
};
export type PermissionRecord = Timestamps & {
  id: string;
  code: string;
  description: string | null;
};

const mapRole = (r: Row): RoleRecord => ({
  id: str(r, 'id'),
  name: str(r, 'name'),
  description: strOrNull(r, 'description'),
  isSystem: toBool(r['is_system']),
  createdAt: toDate(r['created_at']),
  updatedAt: toDate(r['updated_at']),
});
const mapPermission = (r: Row): PermissionRecord => ({
  id: str(r, 'id'),
  code: str(r, 'code'),
  description: strOrNull(r, 'description'),
  createdAt: toDate(r['created_at']),
  updatedAt: toDate(r['updated_at']),
});

export function rolesRepository(db: Db) {
  return {
    async findByName(name: string): Promise<RoleRecord | null> {
      const row = await selectOne(db, 'SELECT * FROM roles WHERE name = ?', [name]);
      return row ? mapRole(row) : null;
    },
    async list(): Promise<RoleRecord[]> {
      return (await selectRows(db, 'SELECT * FROM roles ORDER BY name')).map(mapRole);
    },
    /** Insert, or refresh description/is_system when the name already exists. Idempotent. */
    async upsertByName(input: {
      name: string;
      description?: string | null;
      isSystem: boolean;
    }): Promise<RoleRecord> {
      const row = await selectOne(
        db,
        `INSERT INTO roles (name, description, is_system) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description), is_system = VALUES(is_system)
         RETURNING *`,
        [input.name, input.description ?? null, input.isSystem ? 1 : 0],
      );
      return mapRole(row as Row);
    },
  };
}

export function permissionsRepository(db: Db) {
  return {
    async findByCode(code: string): Promise<PermissionRecord | null> {
      const row = await selectOne(db, 'SELECT * FROM permissions WHERE code = ?', [code]);
      return row ? mapPermission(row) : null;
    },
    async list(): Promise<PermissionRecord[]> {
      return (await selectRows(db, 'SELECT * FROM permissions ORDER BY code')).map(mapPermission);
    },
    /** Every permission code the user holds through any role. */
    async listCodesForUser(userId: string): Promise<string[]> {
      const rows = await selectRows(
        db,
        `SELECT DISTINCT p.code
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = ?
          ORDER BY p.code`,
        [userId],
      );
      return rows.map((r) => String(r['code']));
    },
    async upsertByCode(input: {
      code: string;
      description?: string | null;
    }): Promise<PermissionRecord> {
      const row = await selectOne(
        db,
        `INSERT INTO permissions (code, description) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)
         RETURNING *`,
        [input.code, input.description ?? null],
      );
      return mapPermission(row as Row);
    },
  };
}

export function rolePermissionsRepository(db: Db) {
  return {
    /** Idempotent: granting an existing pair is a no-op. */
    async grant(roleId: string, permissionId: string): Promise<void> {
      await guarded('Role permission', () =>
        exec(
          db,
          `INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE role_id = role_id`,
          [roleId, permissionId],
        ),
      );
    },
    async revoke(roleId: string, permissionId: string): Promise<boolean> {
      const res = await exec(
        db,
        'DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?',
        [roleId, permissionId],
      );
      return res.affectedRows > 0;
    },
    async listPermissionCodes(roleId: string): Promise<string[]> {
      const rows = await selectRows(
        db,
        `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ? ORDER BY p.code`,
        [roleId],
      );
      return rows.map((r) => String(r['code']));
    },
  };
}

export function userRolesRepository(db: Db) {
  return {
    async assign(userId: string, roleId: string): Promise<void> {
      await guarded('User role', () =>
        exec(db, 'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]),
      );
    },
    async remove(userId: string, roleId: string): Promise<boolean> {
      const res = await exec(db, 'DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [
        userId,
        roleId,
      ]);
      return res.affectedRows > 0;
    },
    async listRoleNames(userId: string): Promise<string[]> {
      const rows = await selectRows(
        db,
        `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.name`,
        [userId],
      );
      return rows.map((r) => String(r['name']));
    },
  };
}
