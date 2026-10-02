import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { DbPool } from '../db/pool';
import { AppError } from '../errors/app-error';
import { createAuthService } from './auth-service';
import type { AuthConfig } from './config';
import { AUTHENTICATE_MARK, AUTHORIZE_MARK, createGuards, hasMark, markValue } from './guards';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import { registerAuthRoutes } from './routes';
import type { RouteInfo } from './types';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Wires authentication into the app. Must be registered BEFORE any other route, because it installs
 * a hook that refuses to register a route that is neither guarded nor explicitly public.
 */
export async function registerAuth(
  app: FastifyInstance,
  deps: { pool: DbPool; config: AuthConfig; limiter?: RateLimiter },
): Promise<void> {
  const { pool, config } = deps;
  const limiter =
    deps.limiter ??
    createRateLimiter({ max: config.rateLimitMax, windowMs: config.rateLimitWindowMs });

  await app.register(cookie);

  const service = createAuthService(pool, config);
  app.decorate('guards', createGuards({ pool, service, config }));
  app.decorate('routeRegistry', [] as RouteInfo[]);

  // Browsers attach Origin to cross-site writes. Refuse any that is not an allowed origin.
  // Requests without Origin (scripts, curl) pass here and still need the CSRF token when signed in.
  app.addHook('onRequest', async (request) => {
    const origin = request.headers.origin;
    if (
      UNSAFE_METHODS.has(request.method) &&
      origin !== undefined &&
      !config.allowedOrigins.includes(origin)
    ) {
      throw new AppError('ORIGIN_NOT_ALLOWED', 'Origin not allowed', 403);
    }
  });

  // Deny by default: a route must authenticate, or be marked public on purpose.
  app.addHook('onRoute', (route) => {
    const methods = [route.method].flat();
    const isPublic = route.config?.public === true;
    const hooks = [route.onRequest ?? []].flat();
    const marks = hooks
      .map((h) => markValue(h, AUTHORIZE_MARK))
      .filter((v) => typeof v === 'string');
    const project = marks.find((v) => v.startsWith('project:'));
    for (const method of methods)
      app.routeRegistry.push({
        method,
        url: route.url,
        public: isPublic,
        permissions: marks.filter((v) => !v.startsWith('project:')),
        projectParam: project ? project.slice('project:'.length) : null,
      });

    if (isPublic || methods.every((m) => m === 'OPTIONS')) return; // OPTIONS = CORS preflight

    const where = `${methods.join(',')} ${route.url}`;
    if (!hooks.some((h) => hasMark(h, AUTHENTICATE_MARK))) {
      throw new Error(`Route ${where} must use authenticate, or be marked config.public`);
    }
    if (
      route.config?.authenticatedOnly !== true &&
      !hooks.some((h) => hasMark(h, AUTHORIZE_MARK))
    ) {
      throw new Error(
        `Route ${where} must use authorize(...), or be marked config.authenticatedOnly`,
      );
    }
  });

  registerAuthRoutes(app, { service, config, limiter });
}
