import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import mysql, { type Connection } from 'mysql2/promise';
import { connectionOptions } from './pool';

/**
 * Plain-SQL migrations: NNNN_name.up.sql / NNNN_name.down.sql.
 *
 * MariaDB DDL is not transactional, so a failed migration cannot roll itself back.
 * Instead: migrations are small, every down script is written with IF EXISTS, and on failure
 * the runner executes that migration's down script to clean up before re-throwing.
 */

export type MigrationResult = { applied: string[] };
export type RollbackResult = { rolledBack: string[] };
export type MigrationStatus = { name: string; applied: boolean };

const LOCK_NAME = 'boq_migrations';
const LOCK_TIMEOUT_SECONDS = 30;

type Files = { name: string; up: string; down: string };

async function readMigrationFiles(dir: string): Promise<Files[]> {
  const entries = (await readdir(dir)).sort();
  const names = entries
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.slice(0, -'.up.sql'.length));
  const files: Files[] = [];
  for (const name of names) {
    if (!entries.includes(`${name}.down.sql`)) {
      throw new Error(`Migration ${name} has no matching .down.sql`);
    }
    files.push({
      name,
      up: await readFile(join(dir, `${name}.up.sql`), 'utf8'),
      down: await readFile(join(dir, `${name}.down.sql`), 'utf8'),
    });
  }
  return files;
}

const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

async function withMigrationConnection<T>(
  url: string,
  run: (c: Connection) => Promise<T>,
): Promise<T> {
  const conn = await mysql.createConnection({
    ...connectionOptions(url),
    multipleStatements: true,
  });
  try {
    await conn.query("SET time_zone = '+00:00'");
    const [lock] = await conn.query<mysql.RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS got', [
      LOCK_NAME,
      LOCK_TIMEOUT_SECONDS,
    ]);
    if (lock[0]?.['got'] !== 1) throw new Error('Could not acquire the migration lock');
    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name VARCHAR(120) NOT NULL PRIMARY KEY,
         checksum CHAR(64) NOT NULL,
         applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    return await run(conn);
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => undefined);
    await conn.end();
  }
}

async function appliedMap(conn: Connection): Promise<Map<string, string>> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT name, checksum FROM schema_migrations ORDER BY name',
  );
  return new Map(rows.map((r) => [String(r['name']), String(r['checksum'])]));
}

export function migrateUp(url: string, dir: string): Promise<MigrationResult> {
  return withMigrationConnection(url, async (conn) => {
    const files = await readMigrationFiles(dir);
    const applied = await appliedMap(conn);

    // An already-applied migration must not have been edited since.
    for (const f of files) {
      const recorded = applied.get(f.name);
      if (recorded !== undefined && recorded !== checksum(f.up)) {
        throw new Error(`Migration ${f.name} was changed after it was applied`);
      }
    }

    const done: string[] = [];
    for (const f of files.filter((x) => !applied.has(x.name))) {
      try {
        await conn.query(f.up);
      } catch (err) {
        await conn.query(f.down).catch(() => undefined); // best-effort cleanup of a partial apply
        throw new Error(
          `Migration ${f.name} failed and was cleaned up: ${(err as Error).message}`,
          {
            cause: err,
          },
        );
      }
      await conn.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [
        f.name,
        checksum(f.up),
      ]);
      done.push(f.name);
    }
    return { applied: done };
  });
}

/** Roll back the last `steps` applied migrations (default 1), newest first. */
export function migrateDown(url: string, dir: string, steps = 1): Promise<RollbackResult> {
  return withMigrationConnection(url, async (conn) => {
    const files = new Map((await readMigrationFiles(dir)).map((f) => [f.name, f]));
    const applied = [...(await appliedMap(conn)).keys()].sort().reverse().slice(0, steps);
    const done: string[] = [];
    for (const name of applied) {
      const f = files.get(name);
      if (!f) throw new Error(`Cannot roll back ${name}: migration files not found`);
      await conn.query(f.down);
      await conn.query('DELETE FROM schema_migrations WHERE name = ?', [name]);
      done.push(name);
    }
    return { rolledBack: done };
  });
}

export function migrateDownAll(url: string, dir: string): Promise<RollbackResult> {
  return migrateDown(url, dir, Number.MAX_SAFE_INTEGER);
}

export function migrationStatus(url: string, dir: string): Promise<MigrationStatus[]> {
  return withMigrationConnection(url, async (conn) => {
    const files = await readMigrationFiles(dir);
    const applied = await appliedMap(conn);
    return files.map((f) => ({ name: f.name, applied: applied.has(f.name) }));
  });
}
