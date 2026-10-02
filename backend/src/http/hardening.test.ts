import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDF } from '../attachments/testing';
import { createRateLimiter } from '../auth/rate-limit';
import {
  PASSWORD,
  asUser,
  createAuthFixture,
  makeUser,
  signIn,
  type Fixture,
  type Session,
} from '../auth/testing';
import { hasTestDb } from '../db/testing';
import { addErrorReporter } from '../errors/monitoring';
import { costHeadsRepository } from '../repositories';

describe.skipIf(!hasTestDb)('hardening (real MariaDB)', () => {
  let fx: Fixture;
  let dir: string;
  let pm: Session;
  let projectId: string;
  let expenseId: string;
  const logs: string[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'boq-hard-'));
    const logStream = new Writable({
      write(chunk, _enc, done) {
        logs.push(String(chunk));
        done();
      },
    });
    fx = await createAuthFixture(
      { ATTACHMENTS_DIR: dir, LOG_LEVEL: 'info' },
      { logStream, uploadLimiter: createRateLimiter({ max: 3, windowMs: 60_000 }) },
      (app) => {
        const { authenticate } = app.guards;
        app.get(
          '/__t/boom',
          { onRequest: [authenticate], config: { authenticatedOnly: true } },
          () => {
            throw new Error('kaboom with secret-ish detail');
          },
        );
      },
    );
    const u = await makeUser(fx, { roleName: 'Project Manager' });
    pm = await signIn(fx, u.email);
    const head = await costHeadsRepository(fx.db.pool).create({ code: 'HD', name: 'h' });
    projectId = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: asUser(pm, true),
        payload: { code: 'HARD', name: 'h' },
      })
    ).json().data.id;
    expenseId = (
      await fx.app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/expenses`,
        headers: asUser(pm, true),
        payload: {
          costHeadId: head.id,
          vendor: 'V',
          invoiceNo: 'I',
          expenseDate: '2026-01-01',
          amountFils: 5,
        },
      })
    ).json().data.id;
  });
  afterAll(async () => {
    await fx.close();
    await rm(dir, { recursive: true, force: true });
  });

  describe('security headers', () => {
    it('every API response forbids framing, sniffing, referrers and active content', async () => {
      for (const res of [
        await fx.app.inject({ method: 'GET', url: '/api/health' }),
        await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(pm) }),
        await fx.app.inject({ method: 'GET', url: '/api/nope' }),
      ]) {
        expect(res.headers['content-security-policy']).toBe(
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        );
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['cache-control']).toContain('no-store');
        expect(res.headers['strict-transport-security']).toBeUndefined(); // only in production
      }
    });

    it('the attachment download keeps its own sandboxed policy', async () => {
      await fx.app.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/expenses/${expenseId}/attachment`,
        headers: { ...asUser(pm, true), 'content-type': 'application/pdf' },
        payload: Buffer.from(PDF),
      });
      const res = await fx.app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/expenses/${expenseId}/attachment`,
        headers: asUser(pm),
      });
      expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    });

    it('CORS answers only allowed origins', async () => {
      const ok = await fx.app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'http://localhost:5173' },
      });
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      const evil = await fx.app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://evil.example' },
      });
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('readiness: ready when the database answers and the store is writable; never says why not', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.json()).toEqual({ ok: true, data: { status: 'ready' }, error: null });
  });

  it('uploads are rate limited per user', async () => {
    const up = () =>
      fx.app.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/expenses/${expenseId}/attachment`,
        headers: { ...asUser(pm, true), 'content-type': 'application/pdf' },
        payload: Buffer.from(PDF),
      });
    // the limiter allows 3 per minute; one was used by the header test above
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await up()).statusCode);
    expect(codes).toEqual([200, 200, 429, 429]);
    const last = await up();
    expect(last.json().error.code).toBe('RATE_LIMITED');
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('unexpected errors: generic answer, logged once, handed to reporters with the route pattern only', async () => {
    const seen: unknown[] = [];
    const stop = addErrorReporter((err, ctx) => {
      seen.push({ message: (err as Error).message, ...ctx });
    });
    const res = await fx.app.inject({ method: 'GET', url: '/__t/boom?x=1', headers: asUser(pm) });
    stop();
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    expect(res.body).not.toContain('kaboom');
    expect(seen).toEqual([
      expect.objectContaining({
        message: 'kaboom with secret-ish detail',
        source: 'request',
        method: 'GET',
        url: '/__t/boom',
      }),
    ]);
    // a reporter that throws does not break the response
    const stop2 = addErrorReporter(() => {
      throw new Error('reporter down');
    });
    expect(
      (await fx.app.inject({ method: 'GET', url: '/__t/boom', headers: asUser(pm) })).statusCode,
    ).toBe(500);
    stop2();
  });

  it('logs never contain passwords, session tokens, CSRF tokens or cookies', async () => {
    const u = await makeUser(fx, { roleName: 'Viewer' });
    const s = await signIn(fx, u.email);
    await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(s) });
    await fx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: u.email, password: 'wrong-password-123' },
    });
    const text = logs.join('');
    expect(text.length).toBeGreaterThan(100); // logging is on
    for (const secret of [PASSWORD, 'wrong-password-123', s.token, s.csrf, pm.token, pm.csrf])
      expect(text).not.toContain(secret);
    expect(text).not.toMatch(/argon2|boq_session=/);
  });
});
