import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateDownAll, migrateUp, migrationStatus } from './migrator';
import { MIGRATIONS_DIR } from './paths';
import { createTestDatabase, hasTestDb, type TestDatabase } from './testing';

const ALL = [
  '0001_users',
  '0002_access',
  '0003_projects',
  '0004_cost_heads',
  '0005_audit_log',
  '0006_login_lockout',
  '0007_sessions',
  '0008_project_estimates',
  '0009_expenses',
  '0010_budget_thresholds',
  '0011_expenses_actual_index',
];
const APP_TABLES = [
  'audit_log',
  'budget_thresholds',
  'cost_heads',
  'expenses',
  'permissions',
  'project_estimates',
  'project_members',
  'projects',
  'role_permissions',
  'roles',
  'sessions',
  'user_roles',
  'users',
];

describe.skipIf(!hasTestDb)('migrator (real MariaDB)', () => {
  const open: TestDatabase[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((d) => d.drop()));
  });
  const fresh = async () => {
    const db = await createTestDatabase();
    open.push(db);
    return db;
  };
  const tables = async (db: TestDatabase) => {
    const [rows] = await db.pool.query<RowDataPacket[]>(
      'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    return rows.map((r) => String(r['t'])).sort(); // sort in JS: DB collation orders '_' differently
  };

  it('migrates an empty database to the full schema, then does nothing on re-run', async () => {
    const db = await fresh();
    expect(await tables(db)).toEqual([]);

    expect((await migrateUp(db.url, MIGRATIONS_DIR)).applied).toEqual(ALL);
    expect(await tables(db)).toEqual([...APP_TABLES, 'schema_migrations'].sort());

    expect((await migrateUp(db.url, MIGRATIONS_DIR)).applied).toEqual([]);
    expect((await migrationStatus(db.url, MIGRATIONS_DIR)).every((s) => s.applied)).toBe(true);
  });

  it('rolls back cleanly to empty and can migrate again (full round trip)', async () => {
    const db = await fresh();
    await migrateUp(db.url, MIGRATIONS_DIR);

    const down = await migrateDownAll(db.url, MIGRATIONS_DIR);
    expect(down.rolledBack).toEqual([...ALL].reverse());
    expect(await tables(db)).toEqual(['schema_migrations']);
    const [left] = await db.pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM schema_migrations',
    );
    expect(Number(left[0]?.['n'])).toBe(0);

    expect((await migrateUp(db.url, MIGRATIONS_DIR)).applied).toEqual(ALL);
  });

  it('rolls back one step at a time, newest first', async () => {
    const db = await fresh();
    await migrateUp(db.url, MIGRATIONS_DIR);
    expect((await migrateDown(db.url, MIGRATIONS_DIR)).rolledBack).toEqual([
      '0011_expenses_actual_index',
    ]);
    const t = await tables(db);
    expect(t).toContain('budget_thresholds'); // only the index went
    expect(t).toContain('expenses');
  });

  it('refuses to run when an applied migration was edited', async () => {
    const db = await fresh();
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    await migrateUp(db.url, dir);
    const file = join(dir, '0001_users.up.sql');
    await writeFile(file, (await readFile(file, 'utf8')) + '\n-- edited');
    await expect(migrateUp(db.url, dir)).rejects.toThrow(/changed after it was applied/);
  });

  it('cleans up a migration that fails halfway and does not record it', async () => {
    const db = await fresh();
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    await writeFile(join(dir, '0001_ok.up.sql'), 'CREATE TABLE ok_table (id INT PRIMARY KEY);');
    await writeFile(join(dir, '0001_ok.down.sql'), 'DROP TABLE IF EXISTS ok_table;');
    await writeFile(
      join(dir, '0002_bad.up.sql'),
      'CREATE TABLE half_table (id INT PRIMARY KEY); THIS IS NOT SQL;',
    );
    await writeFile(join(dir, '0002_bad.down.sql'), 'DROP TABLE IF EXISTS half_table;');

    await expect(migrateUp(db.url, dir)).rejects.toThrow(/0002_bad failed and was cleaned up/);
    expect(await tables(db)).toEqual(['ok_table', 'schema_migrations']);
    const status = await migrationStatus(db.url, dir);
    expect(status).toEqual([
      { name: '0001_ok', applied: true },
      { name: '0002_bad', applied: false },
    ]);
  });

  it('rejects a migration that has no down script', async () => {
    const db = await fresh();
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    await writeFile(join(dir, '0001_x.up.sql'), 'CREATE TABLE x (id INT PRIMARY KEY);');
    await expect(migrateUp(db.url, dir)).rejects.toThrow(/no matching \.down\.sql/);
  });
});
