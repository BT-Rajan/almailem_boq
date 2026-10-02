/*
 * Operator tool: create the first administrator.
 *   printf '%s' "$PASSWORD" | pnpm --filter @boq/backend admin:bootstrap admin@example.com "Full Name"
 * The password is read from stdin so it never appears in shell history or the process list.
 * Refused once any enabled user can manage users.
 */
/* eslint-disable no-console */
import { existsSync } from 'node:fs';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { createUserAdminService } from '../services/user-admin';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = loadEnv().DATABASE_URL;
const [email, name] = process.argv.slice(2);
if (!url || !email || !name) {
  console.error('Usage (DATABASE_URL set, password on stdin): admin:bootstrap <email> "<name>"');
  process.exit(1);
}

let password = '';
for await (const chunk of process.stdin) password += String(chunk);
password = password.replace(/\r?\n$/, '');

const pool = createPool(url, 2);
try {
  const user = await createUserAdminService(pool).bootstrapAdmin({ email, name, password });
  console.log(
    `Created administrator ${user.email} with roles: ${user.roles.map((r) => r.name).join(', ')}`,
  );
} catch (err) {
  // Never print the input back; validation details name fields only.
  console.error(err instanceof Error ? err.message : 'Failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
