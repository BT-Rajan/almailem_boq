import { fileURLToPath } from 'node:url';

/** Repo-relative locations, resolved from source. Used by the CLI and tests, not the server bundle. */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../database/migrations', import.meta.url),
);
export const ACCESS_SEED_FILE = fileURLToPath(
  new URL('../../../database/seed/access.json', import.meta.url),
);
