import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './config/env';
import { registerErrorHandling } from './errors/error-handler';
import { loggerOptions } from './logging/logger';
import { registerHealthRoute } from './routes/health';

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(env) });

  registerErrorHandling(app);
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  registerHealthRoute(app);

  return app;
}
