import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from './errors/app-error';
import { buildApp } from './app';
import { loadEnv } from './config/env';
import { REDACTED_PATHS } from './logging/logger';
import { z } from 'zod';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }));
  app.get('/__test/app-error', () => {
    throw AppError.forbidden('nope');
  });
  app.get('/__test/zod', () => {
    z.object({ n: z.number() }).parse({ n: 'x' });
  });
  app.get('/__test/boom', () => {
    throw new Error('db password is hunter2');
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('returns the envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, data: { status: 'ok' }, error: null });
  });
});

describe('error handling', () => {
  it('maps AppError', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/app-error' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      ok: false,
      data: null,
      error: { code: 'FORBIDDEN', message: 'nope' },
    });
  });
  it('maps ZodError to 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/zod' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
  it('hides internals of unknown errors', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('hunter2');
    expect(res.json().error).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
  });
  it('returns an envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().ok).toBe(false);
  });
  it('returns an envelope for malformed JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/health',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(res.json().ok).toBe(false);
  });
});

describe('logging', () => {
  it('redacts credentials', () => {
    expect(REDACTED_PATHS).toContain('req.headers.authorization');
    expect(REDACTED_PATHS).toContain('req.headers.cookie');
  });
});
