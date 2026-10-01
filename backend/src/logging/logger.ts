import type { FastifyServerOptions } from 'fastify';
import type { Env } from '../config/env';

/** Paths that must never reach the logs. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.password_hash',
  '*.token',
  '*.secret',
];

/** Structured JSON logging (pino, built into Fastify) with secret redaction. */
export function loggerOptions(env: Env): NonNullable<FastifyServerOptions['logger']> {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  };
}
