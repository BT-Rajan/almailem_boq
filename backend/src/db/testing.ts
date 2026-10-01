import { randomBytes } from 'node:crypto';
import mysql, { type Pool } from 'mysql2/promise';
import { connectionOptions, createPool } from './pool';

/**
 * Test support: each suite gets its own throwaway MariaDB database, created from
 * TEST_DATABASE_URL (a server URL; the user needs privileges on databases named boq_t_*).
 * Real MariaDB only: constraint behaviour is never simulated.
 */
export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
export const hasTestDb = Boolean(TEST_DATABASE_URL);

export type TestDatabase = { url: string; pool: Pool; drop: () => Promise<void> };

export async function createTestDatabase(): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  const name = `boq_t_${randomBytes(6).toString('hex')}`; // hex only, safe as an identifier
  const admin = await mysql.createConnection(connectionOptions(TEST_DATABASE_URL));
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const u = new URL(TEST_DATABASE_URL);
  u.pathname = `/${name}`;
  const url = u.toString();
  const pool = createPool(url, 4);

  return {
    url,
    pool,
    drop: async () => {
      await pool.end();
      const c = await mysql.createConnection(connectionOptions(TEST_DATABASE_URL));
      await c.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await c.end();
    },
  };
}
