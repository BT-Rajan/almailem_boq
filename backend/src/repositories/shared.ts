import type { Row } from '../db/sql';

export type Timestamps = { createdAt: Date; updatedAt: Date };
export type FindOptions = { includeDeleted?: boolean };

export const toBool = (v: unknown): boolean => Number(v) === 1;
export const fromBool = (v: boolean): number => (v ? 1 : 0);
export const toDate = (v: unknown): Date => v as Date;
export const toDateOrNull = (v: unknown): Date | null => (v === null ? null : (v as Date));
export const liveClause = (opts?: FindOptions): string =>
  opts?.includeDeleted ? '' : ' AND deleted_at IS NULL';

/**
 * Build "col = ?, col = ?" from a patch using a fixed field-to-column map.
 * Keys not in the map are ignored, so caller-supplied names never reach the SQL text.
 */
export function buildSet<P extends Record<string, unknown>>(
  patch: P,
  columns: Record<string, string>,
): { sql: string; params: unknown[] } | null {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(columns)) {
    const value = patch[field];
    if (value === undefined) continue;
    parts.push(`${column} = ?`);
    params.push(typeof value === 'boolean' ? fromBool(value) : value);
  }
  return parts.length ? { sql: parts.join(', '), params } : null;
}

/** LIKE pattern matching `text` anywhere, with the user's own % and _ taken literally. */
export const containsPattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** "?, ?, ?" for an IN (...) list. Callers must not pass an empty list. */
export const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

export const str = (row: Row, key: string): string => String(row[key]);
export const strOrNull = (row: Row, key: string): string | null =>
  row[key] === null ? null : String(row[key]);
