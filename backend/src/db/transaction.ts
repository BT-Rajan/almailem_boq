import type { PoolConnection } from 'mysql2/promise';
import type { DbPool } from './pool';

/** A connection inside an open transaction. Repositories accept it as `Db`. */
export type Tx = PoolConnection;

/** Run `work` in one transaction: commit when it resolves, roll back when it throws. */
export async function withTransaction<T>(pool: DbPool, work: (tx: Tx) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
