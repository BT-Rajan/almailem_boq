import { randomBytes } from 'node:crypto';
import mysql, { type Pool } from 'mysql2/promise';
import { connectionOptions, createPool } from './pool';
import { nextSystemNumber } from '../repositories/system-numbers';

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

/**
 * Bulk-load a portfolio for performance tests: `projects` projects, `heads` cost heads, a budget on
 * every head of every project, and `expenses` expenses spread across them (every 20th reversed).
 * Multi-row inserts with placeholders only. Returns the ids it created.
 */
export async function seedPortfolio(
  pool: Pool,
  opts: { projects: number; heads: number; expenses: number; ownerUserId: string; prefix?: string },
): Promise<{ projectIds: string[]; headIds: string[] }> {
  const prefix = opts.prefix ?? 'PF';
  const insertMany = async (sql: string, rows: unknown[][], width: number) => {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const values = chunk.map(() => `(${Array(width).fill('?').join(', ')})`).join(', ');
      await pool.query(`${sql} VALUES ${values}`, chunk.flat());
    }
  };
  const ids = async (table: string, column: string, like: string) =>
    (
      (
        await pool.query(`SELECT id FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column}`, [
          like,
        ])
      )[0] as {
        id: string;
      }[]
    ).map((r) => r.id);

  const pad = (n: number) => String(n).padStart(4, '0');
  // System numbers come from the real counter, so later creates in the same database cannot collide.
  const numbers = async (kind: 'project' | 'cost_head', n: number) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(await nextSystemNumber(pool, kind));
    return out;
  };
  const headNos = await numbers('cost_head', opts.heads);
  const projectNos = await numbers('project', opts.projects);
  await insertMany(
    'INSERT INTO cost_heads (system_no, code, name, display_order)',
    Array.from({ length: opts.heads }, (_, i) => [
      headNos[i],
      `${prefix}H${pad(i)}`,
      `Seed head ${i}`,
      i + 1,
    ]),
    4,
  );
  await insertMany(
    'INSERT INTO projects (system_no, name, owner_user_id, status)',
    Array.from({ length: opts.projects }, (_, i) => [
      projectNos[i],
      `${prefix}P${pad(i)} Seed project`,
      opts.ownerUserId,
      'active',
    ]),
    4,
  );
  const headIds = await ids('cost_heads', 'code', `${prefix}H%`);
  const projectIds = await ids('projects', 'name', `${prefix}P%`);
  await insertMany(
    'INSERT INTO project_estimates (project_id, cost_head_id, amount_fils)',
    projectIds.flatMap((p, pi) =>
      headIds.map((h, hi) => [p, h, 1_000_000 + ((pi * 31 + hi * 17) % 997) * 1_000]),
    ),
    3,
  );
  const expenses = Array.from({ length: opts.expenses }, (_, i) => [
    projectIds[i % projectIds.length],
    headIds[(i * 7) % headIds.length],
    `Vendor ${i % 50}`,
    `${prefix}-INV-${i}`,
    '2026-05-01',
    5_000 + ((i * 7919) % 400_000),
    opts.ownerUserId,
    i % 20 === 0 ? new Date() : null, // every 20th is reversed (excluded from actual)
  ]);
  await insertMany(
    'INSERT INTO expenses (project_id, cost_head_id, vendor, invoice_no, expense_date, amount_fils, created_by, reversed_at)',
    expenses,
    8,
  );
  return { projectIds, headIds };
}
