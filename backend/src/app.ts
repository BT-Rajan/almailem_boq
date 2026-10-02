import cors from '@fastify/cors';
import { createAttachmentStorage } from './attachments/storage';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DbPool } from './db/pool';
import { authConfig } from './auth/config';
import { registerAuth } from './auth/plugin';
import { createRateLimiter, type RateLimiter } from './auth/rate-limit';
import type { Env } from './config/env';
import { registerErrorHandling } from './errors/error-handler';
import { loggerOptions } from './logging/logger';
import { registerAdminCostHeadRoutes } from './routes/admin-cost-heads';
import { registerAdminThresholdRoutes } from './routes/admin-thresholds';
import { registerAdminUserRoutes } from './routes/admin-users';
import { registerApprovalRoutes } from './routes/approvals';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerEstimateRoutes } from './routes/estimates';
import { registerExpenseRoutes } from './routes/expenses';
import { registerSecurityHeaders } from './http/security-headers';
import { registerHealthRoute, registerReadyRoute } from './routes/health';
import { registerProjectRoutes } from './routes/projects';
import { registerSearchRoutes } from './routes/search';

export type AppDeps = {
  /** Required for everything except health. Without it only the public health route exists. */
  pool?: DbPool;
  /** Tests only: capture log output. */
  logStream?: NodeJS.WritableStream;
  /** Tests only: inject a limiter with a controllable clock. */
  limiter?: RateLimiter;
  /** Tests only: inject the attachment upload limiter. */
  uploadLimiter?: RateLimiter;
};

export async function buildApp(env: Env, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(env, deps.logStream),
    trustProxy: env.TRUST_PROXY,
  });

  registerErrorHandling(app);
  registerSecurityHeaders(app, { hsts: authConfig(env).cookieSecure }); // HSTS only when on https
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });

  if (deps.pool) {
    // Auth first: its hook polices every route registered after it.
    await registerAuth(app, {
      pool: deps.pool,
      config: authConfig(env),
      ...(deps.limiter && { limiter: deps.limiter }),
    });
    registerAdminUserRoutes(app, { pool: deps.pool });
    registerAdminCostHeadRoutes(app, { pool: deps.pool });
    registerProjectRoutes(app, { pool: deps.pool });
    registerDashboardRoutes(app, { pool: deps.pool });
    registerSearchRoutes(app, { pool: deps.pool });
    registerEstimateRoutes(app, { pool: deps.pool });
    registerAdminThresholdRoutes(app, { pool: deps.pool });
    registerApprovalRoutes(app, { pool: deps.pool });
    registerExpenseRoutes(app, {
      pool: deps.pool,
      storage: createAttachmentStorage(env.ATTACHMENTS_DIR),
      attachmentMaxBytes: env.ATTACHMENT_MAX_MB * 1024 * 1024,
      uploadLimiter:
        deps.uploadLimiter ??
        createRateLimiter({ max: env.ATTACHMENT_UPLOADS_PER_HOUR, windowMs: 60 * 60 * 1000 }),
    });
    registerReadyRoute(app, { pool: deps.pool, attachmentsDir: env.ATTACHMENTS_DIR });
  }
  registerHealthRoute(app);

  return app;
}
