import { existsSync } from 'node:fs';
import { buildApp } from './app';
import { loadEnv } from './config/env';
import { createPool } from './db/pool';
import { reportError } from './errors/monitoring';

// Local development convenience; production sets real environment variables.
if (existsSync('.env')) process.loadEnvFile('.env');

const env = loadEnv();
if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to start the server');
}
const pool = createPool(env.DATABASE_URL);
const app = await buildApp(env, { pool });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};
// Anything that escapes a request is a bug: report it, then stop (the supervisor restarts us).
const fatal = (source: string) => (err: unknown) => {
  app.log.fatal({ err }, source);
  reportError(err, { source });
  process.exit(1);
};
process.on('uncaughtException', fatal('uncaughtException'));
process.on('unhandledRejection', fatal('unhandledRejection'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
