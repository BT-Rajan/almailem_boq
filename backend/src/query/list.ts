import { PAGE_SIZE_MAX, type SortDirection } from '@boq/shared';
import type { Db } from '../db/pool';
import { selectOne, selectRows, type Row } from '../db/sql';
import { AppError } from '../errors/app-error';

/**
 * The one list builder: search, filters, sort and offset pagination over a fixed SQL spec.
 * Every piece of SQL comes from the spec (written by a repository); the caller only picks keys
 * from its allow-lists and supplies values, which are always bound as parameters.
 */
export type ListSpec<S extends string, F extends string> = {
  /** e.g. "SELECT p.*, u.name AS owner_name" */
  select: string;
  /** e.g. "FROM projects p JOIN users u ON u.id = p.owner_user_id" */
  from: string;
  /** Fixed conditions, always applied. */
  where?: string[];
  /** Columns matched by `q` (contains, case-insensitive by collation). */
  search: string[];
  sorts: Record<S, string>;
  defaultSort: { key: S; dir: SortDirection };
  /** A unique column, appended to every sort so pages are stable. */
  tiebreaker: string;
  /** Filter key -> column, compared with "=". */
  filters: Record<F, string>;
};

export type ListInput<S extends string, F extends string> = {
  q?: string | undefined;
  sort?: S | undefined;
  dir?: SortDirection | undefined;
  page: number;
  pageSize: number;
} & Partial<Record<F, unknown>>;

/** Extra conditions from the caller's own code (e.g. access scope), never from the request. */
export type Condition = { sql: string; params: unknown[] };

const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** LIKE pattern matching `text` anywhere, with the user's own % and _ taken literally. */
export const containsPattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function runList<S extends string, F extends string>(
  db: Db,
  spec: ListSpec<S, F>,
  input: ListInput<S, F>,
  conditions: Condition[] = [],
): Promise<{ rows: Row[]; total: number }> {
  // The schemas already refuse unknown keys; this is the second line of defence.
  const sortKey = input.sort ?? spec.defaultSort.key;
  if (!own(spec.sorts, sortKey)) throw AppError.validation('Unknown sort');
  const dir = (input.sort ? input.dir : undefined) ?? (input.sort ? 'asc' : spec.defaultSort.dir);
  if (dir !== 'asc' && dir !== 'desc') throw AppError.validation('Unknown sort direction');
  if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > PAGE_SIZE_MAX)
    throw AppError.validation('Invalid page size');
  if (!Number.isInteger(input.page) || input.page < 1) throw AppError.validation('Invalid page');

  const where = [...(spec.where ?? [])];
  const params: unknown[] = [];
  for (const c of conditions) {
    where.push(c.sql);
    params.push(...c.params);
  }
  for (const key of Object.keys(spec.filters) as F[]) {
    const value = input[key];
    if (value === undefined) continue;
    where.push(`${spec.filters[key]} = ?`);
    params.push(value);
  }
  if (input.q) {
    where.push(`(${spec.search.map((col) => `${col} LIKE ?`).join(' OR ')})`);
    params.push(...spec.search.map(() => containsPattern(input.q as string)));
  }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const order = ` ORDER BY ${spec.sorts[sortKey]} ${dir.toUpperCase()}, ${spec.tiebreaker} ${dir.toUpperCase()}`;

  const count = await selectOne(db, `SELECT COUNT(*) AS n ${spec.from}${clause}`, params);
  const rows = await selectRows(
    db,
    `${spec.select} ${spec.from}${clause}${order} LIMIT ? OFFSET ?`,
    [...params, input.pageSize, (input.page - 1) * input.pageSize],
  );
  return { rows, total: Number(count?.['n'] ?? 0) };
}

/** Rows of projects the user may see: null = every project. Reused by every project-scoped list. */
export function memberScope(alias: string, memberUserId: string | null): Condition[] {
  return memberUserId === null
    ? []
    : [
        {
          sql: `EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ${alias} AND m.user_id = ?)`,
          params: [memberUserId],
        },
      ];
}

/** Conditions as " AND ..." text plus their parameters, for hand-written queries. */
export function andConditions(conditions: Condition[]): { sql: string; params: unknown[] } {
  return {
    sql: conditions.map((c) => ` AND ${c.sql}`).join(''),
    params: conditions.flatMap((c) => c.params),
  };
}
