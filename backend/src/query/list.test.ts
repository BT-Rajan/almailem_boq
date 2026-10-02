import { describe, expect, it } from 'vitest';
import type { Db } from '../db/pool';
import { containsPattern, memberScope, runList, type ListSpec } from './list';

/** A fake connection that records every statement and its parameters. */
function recorder() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    execute: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return [sql.startsWith('SELECT COUNT') ? [{ n: 0 }] : []];
    },
  } as unknown as Db;
  return { db, calls };
}

type S = 'code' | 'name';
const spec: ListSpec<S, 'status'> = {
  select: 'SELECT t.*',
  from: 'FROM things t',
  where: ['t.deleted_at IS NULL'],
  search: ['t.code', 't.name'],
  sorts: { code: 't.code', name: 't.name' },
  defaultSort: { key: 'code', dir: 'asc' },
  tiebreaker: 't.id',
  filters: { status: 't.status' },
};

describe('runList', () => {
  it('builds count and page queries from the spec, with every value bound', async () => {
    const { db, calls } = recorder();
    await runList(
      db,
      spec,
      {
        q: "50%_off' OR 1=1 --",
        status: 'active',
        sort: 'name',
        dir: 'desc',
        page: 3,
        pageSize: 20,
      },
      [{ sql: 't.owner = ?', params: ['u1'] }],
    );
    expect(calls[0]).toEqual({
      sql: 'SELECT COUNT(*) AS n FROM things t WHERE t.deleted_at IS NULL AND t.owner = ? AND t.status = ? AND (t.code LIKE ? OR t.name LIKE ?)',
      params: ['u1', 'active', "%50\\%\\_off' OR 1=1 --%", "%50\\%\\_off' OR 1=1 --%"],
    });
    expect(calls[1]?.sql).toBe(
      'SELECT t.* FROM things t WHERE t.deleted_at IS NULL AND t.owner = ? AND t.status = ? AND (t.code LIKE ? OR t.name LIKE ?) ORDER BY t.name DESC, t.id DESC LIMIT ? OFFSET ?',
    );
    expect(calls[1]?.params.slice(-2)).toEqual([20, 40]);
    // the user's text never reaches the SQL itself
    for (const c of calls) expect(c.sql).not.toContain('OR 1=1');
  });

  it('uses the default sort, and asc when a sort is chosen without a direction', async () => {
    const { db, calls } = recorder();
    await runList(
      db,
      { ...spec, defaultSort: { key: 'code', dir: 'desc' } },
      { page: 1, pageSize: 10 },
    );
    expect(calls[1]?.sql).toContain('ORDER BY t.code DESC, t.id DESC');
    await runList(db, spec, { sort: 'name', page: 1, pageSize: 10 });
    expect(calls[3]?.sql).toContain('ORDER BY t.name ASC, t.id ASC');
  });

  it('ignores filters that are not in the spec and keys that are undefined', async () => {
    const { db, calls } = recorder();
    await runList(db, spec, {
      page: 1,
      pageSize: 10,
      ...({ 'status; DROP TABLE x': 'y' } as object),
    });
    expect(calls[0]?.sql).toBe('SELECT COUNT(*) AS n FROM things t WHERE t.deleted_at IS NULL');
  });

  it.each([
    [{ sort: 'id; DROP TABLE things' }],
    [{ sort: '__proto__' }],
    [{ sort: 'constructor' }],
    [{ sort: 'toString' }],
    [{ sort: 'name', dir: 'sideways' }],
    [{ pageSize: 101 }],
    [{ pageSize: 0 }],
    [{ pageSize: 1.5 }],
    [{ page: 0 }],
  ])('refuses %j before touching the database', async (bad) => {
    const { db, calls } = recorder();
    await expect(
      runList(db, spec, { page: 1, pageSize: 10, ...(bad as object) }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(calls).toEqual([]);
  });
});

describe('helpers', () => {
  it('containsPattern escapes LIKE wildcards and the escape character', () => {
    expect(containsPattern('a%b_c\\d')).toBe('%a\\%b\\_c\\\\d%');
  });
  it('memberScope is empty for "everything" and a bound condition otherwise', () => {
    expect(memberScope('p.id', null)).toEqual([]);
    expect(memberScope('p.id', 'u1')).toEqual([
      {
        sql: 'EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)',
        params: ['u1'],
      },
    ]);
  });
});
