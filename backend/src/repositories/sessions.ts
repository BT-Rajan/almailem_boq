import type { Db } from '../db/pool';
import { exec, selectOne } from '../db/sql';
import { str } from './shared';

export type NewSession = {
  userId: string;
  tokenHash: string;
  csrfToken: string;
  absoluteSeconds: number;
  ip?: string | null;
  userAgent?: string | null;
};

/** A live session joined to its user. Disabled or deleted users never match. */
export type ActiveSession = {
  id: string;
  csrfToken: string;
  user: { id: string; email: string; name: string };
};

export function sessionsRepository(db: Db) {
  return {
    async create(input: NewSession): Promise<string> {
      const row = await selectOne(
        db,
        `INSERT INTO sessions (user_id, token_hash, csrf_token, ip, user_agent, expires_at)
         VALUES (?, ?, ?, ?, ?, TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(3)))
         RETURNING id`,
        [
          input.userId,
          input.tokenHash,
          input.csrfToken,
          input.ip ?? null,
          input.userAgent?.slice(0, 255) ?? null,
          input.absoluteSeconds,
        ],
      );
      return str(row as never, 'id');
    },

    /**
     * Find a session that is unexpired (absolute), not idle for too long, and whose user is
     * still enabled and not deleted. All time checks use the database clock.
     */
    async findActive(tokenHash: string, idleSeconds: number): Promise<ActiveSession | null> {
      const row = await selectOne(
        db,
        `SELECT s.id, s.csrf_token, u.id AS user_id, u.email, u.name
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?
            AND s.expires_at > CURRENT_TIMESTAMP(3)
            AND s.last_seen_at > TIMESTAMPADD(SECOND, -?, CURRENT_TIMESTAMP(3))
            AND u.disabled = 0 AND u.deleted_at IS NULL`,
        [tokenHash, idleSeconds],
      );
      if (!row) return null;
      return {
        id: str(row, 'id'),
        csrfToken: str(row, 'csrf_token'),
        user: { id: str(row, 'user_id'), email: str(row, 'email'), name: str(row, 'name') },
      };
    },

    /** Slide the idle window, at most once per minute per session, to avoid a write on every request. */
    async touch(id: string): Promise<void> {
      await exec(
        db,
        `UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND last_seen_at < TIMESTAMPADD(SECOND, -60, CURRENT_TIMESTAMP(3))`,
        [id],
      );
    },
    async deleteByTokenHash(tokenHash: string): Promise<void> {
      await exec(db, 'DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    },
    async delete(id: string): Promise<boolean> {
      const res = await exec(db, 'DELETE FROM sessions WHERE id = ?', [id]);
      return res.affectedRows > 0;
    },
    /** Sign a user out everywhere (disable, password change). Returns how many sessions ended. */
    async deleteAllForUser(userId: string): Promise<number> {
      const res = await exec(db, 'DELETE FROM sessions WHERE user_id = ?', [userId]);
      return res.affectedRows;
    },
    async deleteExpired(idleSeconds: number): Promise<number> {
      const res = await exec(
        db,
        `DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP(3)
            OR last_seen_at <= TIMESTAMPADD(SECOND, -?, CURRENT_TIMESTAMP(3))`,
        [idleSeconds],
      );
      return res.affectedRows;
    },
    async countForUser(userId: string): Promise<number> {
      const row = await selectOne(db, 'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [
        userId,
      ]);
      return Number(row?.['n'] ?? 0);
    },
  };
}
