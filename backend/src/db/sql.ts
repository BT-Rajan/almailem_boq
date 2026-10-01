import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Db } from './pool';

/** Typed helpers over prepared statements. Only repositories and db/ tooling use these. */
export type Row = RowDataPacket;

export async function selectRows<T extends Row>(
  db: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const [rows] = await db.execute<T[]>(sql, params as never[]);
  return rows;
}

export async function selectOne<T extends Row>(
  db: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await selectRows<T>(db, sql, params);
  return rows[0] ?? null;
}

export async function exec(
  db: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<ResultSetHeader> {
  const [result] = await db.execute<ResultSetHeader>(sql, params as never[]);
  return result;
}
