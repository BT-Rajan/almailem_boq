import { guarded } from '../db/errors';
import type { Db } from '../db/pool';
import { exec, selectOne, type Row } from '../db/sql';
import {
  buildSet,
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
  deletedAt: toDateOrNull(r['deleted_at']),
  createdAt: toDate(r['created_at']),
  updatedAt: toDate(r['updated_at']),
});

const COLUMNS = { name: 'name', passwordHash: 'password_hash', disabled: 'disabled' };

export function usersRepository(db: Db) {
  return {
    async create(input: NewUser): Promise<UserRecord> {
      return guarded('User', async () => {
        const row = await selectOne(
          db,
          'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING *',
          [input.email, input.name, input.passwordHash],
        );
        return map(row as Row);
      });
    },
    async findById(id: string, opts?: FindOptions): Promise<UserRecord | null> {
      const row = await selectOne(db, `SELECT * FROM users WHERE id = ?${liveClause(opts)}`, [id]);
      return row ? map(row) : null;
    },
    async findByEmail(email: string, opts?: FindOptions): Promise<UserRecord | null> {
      const row = await selectOne(db, `SELECT * FROM users WHERE email = ?${liveClause(opts)}`, [
        email,
      ]);
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
  };
}
