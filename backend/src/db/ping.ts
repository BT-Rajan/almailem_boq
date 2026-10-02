import type { DbPool } from './pool';

/** True when the database answers a trivial query. Used by the readiness check. */
export async function pingDatabase(pool: DbPool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
