/* Operator tool, run with tsx: `pnpm --filter @boq/backend db:migrate`. Prints to stdout on purpose. */
/* eslint-disable no-console */
import { existsSync } from 'node:fs';
import { loadEnv } from '../config/env';
import { migrateDown, migrateDownAll, migrateUp, migrationStatus } from './migrator';
import { ACCESS_SEED_FILE, MIGRATIONS_DIR } from './paths';
import { createPool } from './pool';
import { loadAccessSeed, seedAccess } from './seed';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = loadEnv().DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const [command, arg] = process.argv.slice(2);

switch (command) {
  case 'migrate': {
    const { applied } = await migrateUp(url, MIGRATIONS_DIR);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date');
    break;
  }
  case 'rollback': {
    const { rolledBack } =
      arg === 'all'
        ? await migrateDownAll(url, MIGRATIONS_DIR)
        : await migrateDown(url, MIGRATIONS_DIR, Number(arg ?? 1));
    console.log(
      rolledBack.length ? `Rolled back: ${rolledBack.join(', ')}` : 'Nothing to roll back',
    );
    break;
  }
  case 'status': {
    for (const s of await migrationStatus(url, MIGRATIONS_DIR))
      console.log(`${s.applied ? 'applied' : 'pending'}  ${s.name}`);
    break;
  }
  case 'seed': {
    const pool = createPool(url, 2);
    const counts = await seedAccess(pool, await loadAccessSeed(ACCESS_SEED_FILE));
    await pool.end();
    console.log(`Seeded ${counts.roles} roles and ${counts.permissions} permissions`);
    break;
  }
  default:
    console.error('Usage: cli.ts migrate | rollback [n|all] | status | seed');
    process.exit(1);
}
