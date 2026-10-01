import { existsSync } from 'node:fs';
import { buildApp } from './app';
import { loadEnv } from './config/env';

// Local development convenience; production sets real environment variables.
if (existsSync('.env')) process.loadEnvFile('.env');

const env = loadEnv();
const app = await buildApp(env);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
