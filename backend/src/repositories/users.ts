import type { UserRef } from '@boq/shared';
import { guarded } from '../db/errors';
import type { Db } from '../db/pool';
import { exec, selectOne, selectRows, type Row } from '../db/sql';
import {
  buildSet,
  containsPattern,
  liveClause,
  str,
  toBool,
  toDate,
  toDateOrNull,
  type FindOptions,
  type Timestamps,
} from './shared';

/** Server-side record. Contains passwordHash, so it must never be sent to a client as-is. */
export type UserRecord = Timestamps & {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  disabled: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  /** True while the account is locked, judged by the database clock. */
  locked: boolean;
  deletedAt: Date | null;
};
export type NewUser = { email: string; name: string; passwordHash: string };
export type UserPatch = { name?: string; passwordHash?: string; disabled?: boolean };

const map = (r: Row): UserRecord => ({
  id: str(r, 'id'),
  email: str(r, 'email'),
  name: str(r, 'name'),
  passwordHash: str(r, 'password_hash'),
  disabled: toBool(r['disabled']),
  failedLoginCount: Number(r['failed_login_count']),
  lockedUntil: toDateOrNull(r['locked_until']),
  locked: toBool(r['is_locked']),
  deletedAt: toDateOrNull(r['deleted_at']),
  createdAt: toDate(r['created_at']),
  updatedAt: toDate(r['updated_at']),
});

// is_locked is computed with the database clock, so lock checks never depend on app/DB clock drift.
const SELECT_USER =
  'SELECT *, (locked_until IS NOT NULL AND locked_until > CURRENT_TIMESTAMP(3)) AS is_locked FROM users';

const COLUMNS = { name: 'name', passwordHash: 'password_hash', disabled: 'disabled' };

export function usersRepository(db: Db) {
  return {
    async create(input: NewUser): Promise<UserRecord> {
      return guarded('User', async () => {
        const row = await selectOne(
          db,
          'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING *, 0 AS is_locked',
          [input.email, input.name, input.passwordHash],
        );
        return map(row as Row);
      });
    },
    async findById(id: string, opts?: FindOptions): Promise<UserRecord | null> {
      const row = await selectOne(db, `${SELECT_USER} WHERE id = ?${liveClause(opts)}`, [id]);
      return row ? map(row) : null;
    },
    /** Live users (disabled included), newest first, optionally filtered by name or email. */
    async search(opts: {
      search?: string | undefined;
      limit: number;
      offset: number;
    }): Promise<{ rows: UserRecord[]; total: number }> {
      const filter = opts.search ? ' AND (name LIKE ? OR email LIKE ?)' : '';
      const like = opts.search ? [containsPattern(opts.search), containsPattern(opts.search)] : [];
      const count = await selectOne(
        db,
        `SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL${filter}`,
        like,
      );
      const rows = await selectRows(
        db,
        `${SELECT_USER} WHERE deleted_at IS NULL${filter} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
        [...like, opts.limit, opts.offset],
      );
      return { rows: rows.map(map), total: Number(count?.['n'] ?? 0) };
    },
    /** Enabled, live users matching name or email, for pickers. Never returns secrets. */
    async lookup(search: string | undefined, limit: number): Promise<UserRef[]> {
      const filter = search ? ' AND (name LIKE ? OR email LIKE ?)' : '';
      const rows = await selectRows(
        db,
        `SELECT id, name, email FROM users WHERE deleted_at IS NULL AND disabled = 0${filter}
          ORDER BY name, email LIMIT ?`,
        [...(search ? [containsPattern(search), containsPattern(search)] : []), limit],
      );
      return rows.map((r) => ({ id: str(r, 'id'), name: str(r, 'name'), email: str(r, 'email') }));
    },
    /** How many enabled, live users hold `permissionCode` through any role. */
    async countEnabledHolding(permissionCode: string): Promise<number> {
      const row = await selectOne(
        db,
        `SELECT COUNT(DISTINCT u.id) AS n
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE p.code = ? AND u.disabled = 0 AND u.deleted_at IS NULL`,
        [permissionCode],
      );
      return Number(row?.['n'] ?? 0);
    },
    async findByEmail(email: string, opts?: FindOptions): Promise<UserRecord | null> {
      const row = await selectOne(db, `${SELECT_USER} WHERE email = ?${liveClause(opts)}`, [email]);
      return row ? map(row) : null;
    },
    /** Returns false when the user does not exist (or is deleted) or the patch is empty. */
    async update(id: string, patch: UserPatch): Promise<boolean> {
      const set = buildSet(patch, COLUMNS);
      if (!set) return false;
      const res = await exec(
        db,
        `UPDATE users SET ${set.sql} WHERE id = ? AND deleted_at IS NULL`,
        [...set.params, id],
      );
      return res.affectedRows > 0;
    },
    async softDelete(id: string): Promise<boolean> {
      const res = await exec(
        db,
        'UPDATE users SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND deleted_at IS NULL',
        [id],
      );
      return res.affectedRows > 0;
    },
    /**
     * Count a failed login and lock the account once `maxAttempts` is reached.
     * One atomic statement. MariaDB evaluates SET left to right and later assignments see earlier
     * ones, so locked_until must come BEFORE failed_login_count to read the old count.
     */
    async recordFailedLogin(
      id: string,
      maxAttempts: number,
      lockSeconds: number,
    ): Promise<{ failedLoginCount: number; locked: boolean }> {
      await exec(
        db,
        `UPDATE users
            SET locked_until = IF(failed_login_count + 1 >= ?, TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(3)), locked_until),
                failed_login_count = failed_login_count + 1
          WHERE id = ?`,
        [maxAttempts, lockSeconds, id],
      );
      const user = await this.findById(id, { includeDeleted: true });
      return { failedLoginCount: user?.failedLoginCount ?? 0, locked: user?.locked ?? false };
    },
    async recordSuccessfulLogin(id: string): Promise<void> {
      await exec(db, 'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?', [
        id,
      ]);
    },
    /** A lock that has run out is cleared, and the failure counter starts again from zero. */
    async clearExpiredLock(id: string): Promise<void> {
      await exec(
        db,
        `UPDATE users SET failed_login_count = 0, locked_until = NULL
          WHERE id = ? AND locked_until IS NOT NULL AND locked_until <= CURRENT_TIMESTAMP(3)`,
        [id],
      );
    },
  };
}
