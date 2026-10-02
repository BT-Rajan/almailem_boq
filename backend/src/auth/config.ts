import type { Env } from '../config/env';

export type AuthConfig = {
  idleSeconds: number;
  absoluteSeconds: number;
  maxAttempts: number;
  lockSeconds: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  cookieName: string;
  cookieSecure: boolean;
  allowedOrigins: readonly string[];
};

export function authConfig(env: Env): AuthConfig {
  const secure =
    env.COOKIE_SECURE === 'auto' ? env.NODE_ENV === 'production' : env.COOKIE_SECURE === 'true';
  return {
    idleSeconds: env.SESSION_IDLE_MINUTES * 60,
    absoluteSeconds: env.SESSION_ABSOLUTE_HOURS * 3600,
    maxAttempts: env.LOGIN_MAX_ATTEMPTS,
    lockSeconds: env.LOGIN_LOCK_MINUTES * 60,
    rateLimitMax: env.LOGIN_RATE_LIMIT,
    rateLimitWindowMs: 15 * 60 * 1000,
    // The __Host- prefix makes browsers insist on Secure, Path=/ and no Domain.
    cookieName: secure ? '__Host-boq_session' : 'boq_session',
    cookieSecure: secure,
    allowedOrigins: env.CORS_ORIGINS,
  };
}
