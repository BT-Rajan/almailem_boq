import type { FastifyInstance } from 'fastify';
import { loginRequestSchema, okResponse } from '@boq/shared';
import { AppError } from '../errors/app-error';
import type { AuthService } from './auth-service';
import { toSessionInfo } from './auth-service';
import type { AuthConfig } from './config';
import type { RateLimiter } from './rate-limit';

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { service: AuthService; config: AuthConfig; limiter: RateLimiter },
): void {
  const { service, config, limiter } = deps;
  const { authenticate } = app.guards;

  const cookieOptions = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: config.absoluteSeconds,
  };

  app.post('/api/auth/login', { config: { public: true } }, async (request, reply) => {
    // Rate limit first: it applies equally to real and unknown emails.
    const verdict = limiter.take(request.ip);
    if (!verdict.allowed) {
      void reply.header('retry-after', String(verdict.retryAfterSeconds));
      throw AppError.rateLimited();
    }
    const credentials = loginRequestSchema.parse(request.body);

    const oldToken = request.cookies[config.cookieName];
    if (oldToken) await service.revokeToken(oldToken);

    const { token, info } = await service.login(credentials, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    void reply
      .setCookie(config.cookieName, token, cookieOptions)
      .header('cache-control', 'no-store');
    return okResponse(info);
  });

  app.post(
    '/api/auth/logout',
    { onRequest: [authenticate], config: { authenticatedOnly: true } },
    async (request, reply) => {
      await service.logout(request.auth as NonNullable<typeof request.auth>);
      void reply.clearCookie(config.cookieName, { path: '/' }).header('cache-control', 'no-store');
      return okResponse({ loggedOut: true as const });
    },
  );

  app.get(
    '/api/auth/me',
    { onRequest: [authenticate], config: { authenticatedOnly: true } },
    async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      return okResponse(toSessionInfo(request.auth as NonNullable<typeof request.auth>));
    },
  );
}
