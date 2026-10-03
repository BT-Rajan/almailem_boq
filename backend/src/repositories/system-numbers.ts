import type { Db } from '../db/pool';
import { exec, selectOne } from '../db/sql';
import { AppError } from '../errors/app-error';

/**
 * System numbers (migration 0014): projects P00001..., cost heads C001.... Assigned here, at
 * insert, and never accepted from a request. `db` must be the transaction that inserts the record:
 * the UPDATE row-locks the counter until it commits, so concurrent creates queue rather than share
 * a number, and a rollback gives the number back. The UNIQUE key on the column backs this up.
 */
const FORMAT = {
  project: { prefix: 'P', digits: 5 },
  cost_head: { prefix: 'C', digits: 3 },
} as const;

export type SystemNumberKind = keyof typeof FORMAT;

export async function nextSystemNumber(db: Db, kind: SystemNumberKind): Promise<string> {
  await exec(db, 'UPDATE system_counters SET last_value = last_value + 1 WHERE name = ?', [kind]);
  const row = await selectOne(db, 'SELECT last_value FROM system_counters WHERE name = ?', [kind]);
  if (!row) throw new Error(`system_counters row '${kind}' is missing; run the migrations`);
  const { prefix, digits } = FORMAT[kind];
  const n = Number(row['last_value']);
  if (n >= 10 ** digits) {
    throw AppError.conflict(`No ${prefix} numbers left (the limit is ${10 ** digits - 1})`);
  }
  return `${prefix}${String(n).padStart(digits, '0')}`;
}
