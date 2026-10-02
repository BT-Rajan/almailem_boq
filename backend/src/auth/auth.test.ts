import { Writable } from 'node:stream';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF_HEADER, sessionInfoSchema } from '@boq/shared';
import { hasTestDb } from '../db/testing';
import {
  auditLogRepository,
  projectMembersRepository,
  projectsRepository,
  sessionsRepository,
  userRolesRepository,
  rolesRepository,
  usersRepository,
} from '../repositories';
import {
  ALLOWED_ORIGIN,
  PASSWORD,
  asUser,
  createAuthFixture,
  login,
  makeUser,
  signIn,
  uniqueEmail,
  type Fixture,
} from './testing';

const q = async (fx: Fixture, sql: string, params: unknown[] = []) => {
  const [rows] = await fx.db.pool.query<RowDataPacket[]>(sql, params);
  return rows;
};
const WRONG = 'definitely-not-the-password';
const GENERIC = {
  ok: false,
  data: null,
  error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
};

describe.skipIf(!hasTestDb)('authentication and authorization (real MariaDB)', () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await createAuthFixture({}, {}, (app) => {
      const { authenticate, authorize, authorizeProjectAccess } = app.guards;
      app.get('/__t/report', { onRequest: [authenticate, authorize('report.view')] }, () => ({
        ok: 'report',
      }));
      app.get('/__t/admin', { onRequest: [authenticate, authorize('admin.users.manage')] }, () => ({
        ok: 'admin',
      }));
      app.post('/__t/write', { onRequest: [authenticate, authorize('expense.create')] }, () => ({
        ok: 'written',
      }));
      app.get(
        '/__t/projects/:projectId',
        {
          onRequest: [authenticate, authorize('project.view'), authorizeProjectAccess('projectId')],
        },
        (req) => ({ ok: 'project', id: (req.params as { projectId: string }).projectId }),
      );
    });
  });
  afterAll(async () => {
    await fx.close();
  });

  describe('login', () => {
    it('signs in, returns the session info and sets a hardened cookie', async () => {
      const u = await makeUser(fx, { roleName: 'Viewer' });
      const res = await login(fx, u.email);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(sessionInfoSchema.safeParse(body.data).success).toBe(true);
      expect(body.data.user).toEqual({ id: u.id, email: u.email, name: 'Test User' });
      expect(body.data.permissions).toEqual(['expense.view', 'project.view', 'report.view']);
      expect(res.headers['cache-control']).toBe('no-store');

      const cookie = res.cookies[0];
      expect(cookie).toMatchObject({
        name: 'boq_session',
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 12 * 3600,
      });
      expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('never leaks the password or its hash in any response', async () => {
      const u = await makeUser(fx, { roleName: 'Viewer' });
      const s = await signIn(fx, u.email);
      const me = await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(s) });
      for (const text of [s.res.body, me.body]) {
        expect(text).not.toContain(PASSWORD);
        expect(text).not.toMatch(/argon2|password/i);
      }
    });

    it('stores only a hash of the session token', async () => {
      const u = await makeUser(fx);
      const s = await signIn(fx, u.email);
      const rows = await q(fx, 'SELECT token_hash, csrf_token FROM sessions WHERE user_id = ?', [
        u.id,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.['token_hash']).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]?.['token_hash']).not.toBe(s.token);
      expect(JSON.stringify(rows)).not.toContain(s.token);
    });

    it('gives the same generic answer for a wrong password and an unknown email', async () => {
      const u = await makeUser(fx);
      const wrong = await login(fx, u.email, WRONG);
      const unknown = await login(fx, 'nobody@example.com', WRONG);
      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(wrong.json()).toEqual(GENERIC);
      expect(unknown.json()).toEqual(GENERIC);
      expect(wrong.cookies).toHaveLength(0);
    });

    it('treats the email case-insensitively', async () => {
      const u = await makeUser(fx, { email: 'MixedCase@Example.com' });
      expect((await login(fx, 'mixedcase@example.COM')).statusCode).toBe(200);
      expect(u.id).toBeTruthy();
    });

    it('rejects malformed input with a validation error', async () => {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'not-an-email' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      const huge = await login(fx, 'a@example.com', 'x'.repeat(5000));
      expect(huge.statusCode).toBe(400);
    });

    it('replaces the previous session when signing in again from the same browser', async () => {
      const u = await makeUser(fx);
      const first = await signIn(fx, u.email);
      const second = await login(fx, u.email, PASSWORD, { cookie: first.cookie });
      expect(second.statusCode).toBe(200);
      const old = await fx.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: asUser(first),
      });
      expect(old.statusCode).toBe(401);
    });
  });

  describe('current user and logout', () => {
    it('401 without a cookie, with garbage, and clears a stale cookie', async () => {
      const none = await fx.app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(none.statusCode).toBe(401);
      expect(none.json().error.code).toBe('UNAUTHENTICATED');
      const junk = await fx.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: 'boq_session=garbage' },
      });
      expect(junk.statusCode).toBe(401);
      expect(String(junk.headers['set-cookie'])).toMatch(/boq_session=;/);
    });

    it('returns the signed-in user', async () => {
      const u = await makeUser(fx, { roleName: 'Accountant' });
      const s = await signIn(fx, u.email);
      const res = await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(s) });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.user.id).toBe(u.id);
      expect(res.json().data.csrfToken).toBe(s.csrf);
    });

    it('logout needs the CSRF token, then ends the session for good', async () => {
      const u = await makeUser(fx);
      const s = await signIn(fx, u.email);
      const noCsrf = await fx.app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: asUser(s),
      });
      expect(noCsrf.statusCode).toBe(403);
      expect(noCsrf.json().error.code).toBe('CSRF_INVALID');

      const wrong = await fx.app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { ...asUser(s), [CSRF_HEADER]: 'nope' },
      });
      expect(wrong.statusCode).toBe(403);

      const ok = await fx.app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: asUser(s, true),
      });
      expect(ok.statusCode).toBe(200);
      expect(String(ok.headers['set-cookie'])).toMatch(/boq_session=;/);

      expect(
        (await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(s) }))
          .statusCode,
      ).toBe(401);
      expect(await sessionsRepository(fx.db.pool).countForUser(u.id)).toBe(0);
    });
  });

  describe('authorize(permission)', () => {
    it('401 when not signed in', async () => {
      for (const url of ['/__t/report', '/__t/admin']) {
        expect((await fx.app.inject({ method: 'GET', url })).statusCode).toBe(401);
      }
    });
    it('403 when signed in without the permission, 200 with it', async () => {
      const nobody = await signIn(fx, (await makeUser(fx)).email);
      const viewer = await signIn(fx, (await makeUser(fx, { roleName: 'Viewer' })).email);
      const admin = await signIn(fx, (await makeUser(fx, { roleName: 'Admin' })).email);
      const get = (s: typeof viewer, url: string) =>
        fx.app.inject({ method: 'GET', url, headers: asUser(s) });

      expect((await get(nobody, '/__t/report')).statusCode).toBe(403);
      expect((await get(viewer, '/__t/report')).statusCode).toBe(200);
      expect((await get(viewer, '/__t/admin')).statusCode).toBe(403);
      expect((await get(admin, '/__t/admin')).statusCode).toBe(200);
      expect((await get(admin, '/__t/report')).statusCode).toBe(200);
      expect((await get(nobody, '/__t/admin')).json().error.code).toBe('FORBIDDEN');
    });
    it('takes effect immediately when a role is removed (permissions are read per request)', async () => {
      const u = await makeUser(fx, { roleName: 'Viewer' });
      const s = await signIn(fx, u.email);
      const call = () => fx.app.inject({ method: 'GET', url: '/__t/report', headers: asUser(s) });
      expect((await call()).statusCode).toBe(200);
      const role = await rolesRepository(fx.db.pool).findByName('Viewer');
      await userRolesRepository(fx.db.pool).remove(u.id, role?.id as string);
      expect((await call()).statusCode).toBe(403);
    });
  });

  describe('CSRF and origin', () => {
    it('writes need a matching CSRF token; reads do not', async () => {
      const pm = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
      const post = (headers: Record<string, string>) =>
        fx.app.inject({ method: 'POST', url: '/__t/write', headers });
      expect((await post(asUser(pm))).json().error.code).toBe('CSRF_INVALID');
      expect((await post({ ...asUser(pm), [CSRF_HEADER]: 'wrong' })).statusCode).toBe(403);
      expect((await post(asUser(pm, true))).statusCode).toBe(200);
      expect(
        (await fx.app.inject({ method: 'GET', url: '/__t/report', headers: asUser(pm) }))
          .statusCode,
      ).toBe(200);
    });
    it("one session's CSRF token does not work for another session", async () => {
      const email = (await makeUser(fx, { roleName: 'Project Manager' })).email;
      const a = await signIn(fx, email);
      const b = await signIn(fx, email);
      const res = await fx.app.inject({
        method: 'POST',
        url: '/__t/write',
        headers: { ...asUser(a), [CSRF_HEADER]: b.csrf },
      });
      expect(res.statusCode).toBe(403);
    });
    it('permission is still enforced when the CSRF token is right', async () => {
      const viewer = await signIn(fx, (await makeUser(fx, { roleName: 'Viewer' })).email);
      const res = await fx.app.inject({
        method: 'POST',
        url: '/__t/write',
        headers: asUser(viewer, true),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });
    it('blocks writes from a foreign origin, allows the app origin and no origin', async () => {
      const u = await makeUser(fx);
      expect(
        (await login(fx, u.email, PASSWORD, { origin: 'https://evil.example' })).json().error.code,
      ).toBe('ORIGIN_NOT_ALLOWED');
      expect((await login(fx, u.email, PASSWORD, { origin: 'null' })).statusCode).toBe(403);
      expect((await login(fx, u.email, PASSWORD, { origin: ALLOWED_ORIGIN })).statusCode).toBe(200);
      expect((await login(fx, u.email, PASSWORD)).statusCode).toBe(200);
      const get = await fx.app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://evil.example' },
      });
      expect(get.statusCode).toBe(200);
    });
  });

  describe('authorizeProjectAccess(projectId)', () => {
    let owner: Awaited<ReturnType<typeof makeUser>>;
    let projectId: string;
    const projectUrl = (id: string) => `/__t/projects/${id}`;
    const get = (s: Awaited<ReturnType<typeof signIn>>, id: string) =>
      fx.app.inject({ method: 'GET', url: projectUrl(id), headers: asUser(s) });

    beforeAll(async () => {
      owner = await makeUser(fx, { roleName: 'Viewer' });
      projectId = (
        await projectsRepository(fx.db.pool).create({
          code: 'PA-1',
          name: 'Access',
          ownerUserId: owner.id,
          status: 'active',
        })
      ).id;
      await projectMembersRepository(fx.db.pool).add(projectId, owner.id);
    });

    it('lets members in', async () => {
      const s = await signIn(fx, owner.email);
      const res = await get(s, projectId);
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(projectId);
    });
    it('gives non-members the same 403 as a project that does not exist', async () => {
      const outsider = await signIn(fx, (await makeUser(fx, { roleName: 'Viewer' })).email);
      const notMember = await get(outsider, projectId);
      const missing = await get(outsider, '00000000-0000-1000-8000-000000000000');
      const malformed = await get(outsider, 'not-a-uuid');
      for (const r of [notMember, missing, malformed]) expect(r.statusCode).toBe(403);
      expect(notMember.json()).toEqual(missing.json());
      expect(notMember.json()).toEqual(malformed.json());
    });
    it('refuses members of a soft-deleted project', async () => {
      const u = await makeUser(fx, { roleName: 'Viewer' });
      const p = await projectsRepository(fx.db.pool).create({
        code: 'PA-DEL',
        name: 'Gone',
        ownerUserId: owner.id,
        status: 'active',
      });
      await projectMembersRepository(fx.db.pool).add(p.id, u.id);
      const s = await signIn(fx, u.email);
      expect((await get(s, p.id)).statusCode).toBe(200);
      await projectsRepository(fx.db.pool).softDelete(p.id);
      expect((await get(s, p.id)).statusCode).toBe(403);
    });
    it('an Admin counts as a member of every live project without a membership row', async () => {
      const a = await makeUser(fx, { roleName: 'Admin' });
      const s = await signIn(fx, a.email);
      expect(await projectMembersRepository(fx.db.pool).isMember(projectId, a.id)).toBe(false);
      expect((await get(s, projectId)).statusCode).toBe(200);
      // ...but still gets the uniform 403 for missing, malformed and deleted projects
      const gone = await projectsRepository(fx.db.pool).create({
        code: 'PA-ADEL',
        name: 'Gone',
        ownerUserId: owner.id,
        status: 'active',
      });
      expect((await get(s, gone.id)).statusCode).toBe(200);
      await projectsRepository(fx.db.pool).softDelete(gone.id);
      expect((await get(s, gone.id)).statusCode).toBe(403);
      expect((await get(s, '00000000-0000-1000-8000-000000000000')).statusCode).toBe(403);
      expect((await get(s, 'not-a-uuid')).statusCode).toBe(403);
    });
    it('Project Manager and Accountant do not get every project', async () => {
      for (const roleName of ['Project Manager', 'Accountant']) {
        const s = await signIn(fx, (await makeUser(fx, { roleName })).email);
        expect((await get(s, projectId)).statusCode, roleName).toBe(403);
      }
    });
    it('still requires the permission: membership alone is not enough', async () => {
      const u = await makeUser(fx); // no roles
      await projectMembersRepository(fx.db.pool).add(projectId, u.id);
      const s = await signIn(fx, u.email);
      expect((await get(s, projectId)).statusCode).toBe(403);
    });
    it('requires sign-in', async () => {
      expect((await fx.app.inject({ method: 'GET', url: projectUrl(projectId) })).statusCode).toBe(
        401,
      );
    });
  });

  describe('disabled and deleted users', () => {
    it('a disabled user cannot sign in, and gets the generic answer', async () => {
      const u = await makeUser(fx);
      await usersRepository(fx.db.pool).update(u.id, { disabled: true });
      const res = await login(fx, u.email);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(GENERIC);
      expect(await sessionsRepository(fx.db.pool).countForUser(u.id)).toBe(0);
      expect((await usersRepository(fx.db.pool).findById(u.id))?.failedLoginCount).toBe(0);
    });
    it('disabling a user ends their live session on the very next request', async () => {
      const u = await makeUser(fx, { roleName: 'Viewer' });
      const s = await signIn(fx, u.email);
      expect(
        (await fx.app.inject({ method: 'GET', url: '/__t/report', headers: asUser(s) })).statusCode,
      ).toBe(200);
      await usersRepository(fx.db.pool).update(u.id, { disabled: true });
      expect(
        (await fx.app.inject({ method: 'GET', url: '/__t/report', headers: asUser(s) })).statusCode,
      ).toBe(401);
      await usersRepository(fx.db.pool).update(u.id, { disabled: false });
      expect((await login(fx, u.email)).statusCode).toBe(200);
    });
    it('a soft-deleted user can neither sign in nor keep a session', async () => {
      const u = await makeUser(fx);
      const s = await signIn(fx, u.email);
      await usersRepository(fx.db.pool).softDelete(u.id);
      expect(
        (await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(s) }))
          .statusCode,
      ).toBe(401);
      expect((await login(fx, u.email)).json()).toEqual(GENERIC);
    });
    it('deleteAllForUser signs a user out of every device', async () => {
      const u = await makeUser(fx);
      const a = await signIn(fx, u.email);
      const b = await signIn(fx, u.email);
      expect(await sessionsRepository(fx.db.pool).deleteAllForUser(u.id)).toBe(2);
      for (const s of [a, b])
        expect(
          (await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(s) }))
            .statusCode,
        ).toBe(401);
    });
  });

  describe('lockout', () => {
    const failures = async (email: string, n: number) => {
      const out = [];
      for (let i = 0; i < n; i++) out.push((await login(fx, email, WRONG)).statusCode);
      return out;
    };

    it('locks after 5 failures; even the right password is refused while locked', async () => {
      const u = await makeUser(fx);
      expect(await failures(u.email, 4)).toEqual([401, 401, 401, 401]);
      expect((await usersRepository(fx.db.pool).findById(u.id))?.locked).toBe(false);
      await failures(u.email, 1);
      const locked = await usersRepository(fx.db.pool).findById(u.id);
      expect(locked).toMatchObject({ failedLoginCount: 5, locked: true });

      const right = await login(fx, u.email);
      expect(right.statusCode).toBe(401);
      expect(right.json()).toEqual(GENERIC); // does not reveal that the account is locked
      expect(await sessionsRepository(fx.db.pool).countForUser(u.id)).toBe(0);
    });
    it('does not keep counting while locked', async () => {
      const u = await makeUser(fx);
      await failures(u.email, 8);
      expect((await usersRepository(fx.db.pool).findById(u.id))?.failedLoginCount).toBe(5);
    });
    it('unlocks when the lock expires and starts counting from zero', async () => {
      const u = await makeUser(fx);
      await failures(u.email, 5);
      await q(
        fx,
        'UPDATE users SET locked_until = TIMESTAMPADD(MINUTE, -1, CURRENT_TIMESTAMP(3)) WHERE id = ?',
        [u.id],
      );
      expect((await login(fx, u.email)).statusCode).toBe(200);
      expect(await usersRepository(fx.db.pool).findById(u.id)).toMatchObject({
        failedLoginCount: 0,
        locked: false,
        lockedUntil: null,
      });
    });
    it('a wrong password after an expired lock counts as failure 1, not 6', async () => {
      const u = await makeUser(fx);
      await failures(u.email, 5);
      await q(
        fx,
        'UPDATE users SET locked_until = TIMESTAMPADD(MINUTE, -1, CURRENT_TIMESTAMP(3)) WHERE id = ?',
        [u.id],
      );
      await failures(u.email, 1);
      expect(await usersRepository(fx.db.pool).findById(u.id)).toMatchObject({
        failedLoginCount: 1,
        locked: false,
      });
    });
    it('a successful login resets the counter', async () => {
      const u = await makeUser(fx);
      await failures(u.email, 3);
      expect((await login(fx, u.email)).statusCode).toBe(200);
      await failures(u.email, 3);
      expect((await usersRepository(fx.db.pool).findById(u.id))?.locked).toBe(false);
    });
    it('is safe under concurrent attempts: all answered 401, account ends up locked', async () => {
      const u = await makeUser(fx);
      const codes = await Promise.all(
        Array.from({ length: 12 }, () => login(fx, u.email, WRONG).then((r) => r.statusCode)),
      );
      expect(codes.every((c) => c === 401)).toBe(true);
      const after = await usersRepository(fx.db.pool).findById(u.id);
      expect(after?.locked).toBe(true);
      expect(after?.failedLoginCount).toBeGreaterThanOrEqual(5);
    });
    it('attempts on unknown emails create nothing and lock nothing', async () => {
      const before = (await q(fx, 'SELECT COUNT(*) AS n FROM users'))[0]?.['n'];
      for (let i = 0; i < 8; i++)
        expect((await login(fx, 'ghost@example.com', WRONG)).statusCode).toBe(401);
      expect((await q(fx, 'SELECT COUNT(*) AS n FROM users'))[0]?.['n']).toBe(before);
    });
  });

  describe('session lifetime', () => {
    it('ends at the absolute limit', async () => {
      const u = await makeUser(fx);
      const s = await signIn(fx, u.email);
      await q(
        fx,
        'UPDATE sessions SET expires_at = TIMESTAMPADD(SECOND, -1, CURRENT_TIMESTAMP(3)) WHERE user_id = ?',
        [u.id],
      );
      expect(
        (await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(s) }))
          .statusCode,
      ).toBe(401);
    });
    it('ends after the idle limit', async () => {
      const u = await makeUser(fx);
      const s = await signIn(fx, u.email);
      await q(
        fx,
        'UPDATE sessions SET last_seen_at = TIMESTAMPADD(MINUTE, -121, CURRENT_TIMESTAMP(3)) WHERE user_id = ?',
        [u.id],
      );
      expect(
        (await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(s) }))
          .statusCode,
      ).toBe(401);
    });
    it('slides the idle window while the user is active', async () => {
      const u = await makeUser(fx);
      const s = await signIn(fx, u.email);
      await q(
        fx,
        'UPDATE sessions SET last_seen_at = TIMESTAMPADD(MINUTE, -30, CURRENT_TIMESTAMP(3)) WHERE user_id = ?',
        [u.id],
      );
      expect(
        (await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(s) }))
          .statusCode,
      ).toBe(200);
      const age = await q(
        fx,
        'SELECT TIMESTAMPDIFF(SECOND, last_seen_at, CURRENT_TIMESTAMP(3)) AS s FROM sessions WHERE user_id = ?',
        [u.id],
      );
      expect(Number(age[0]?.['s'])).toBeLessThan(5);
    });
    it('purges expired sessions on the next login', async () => {
      const u = await makeUser(fx);
      await signIn(fx, u.email);
      await q(
        fx,
        'UPDATE sessions SET expires_at = TIMESTAMPADD(SECOND, -1, CURRENT_TIMESTAMP(3)) WHERE user_id = ?',
        [u.id],
      );
      await signIn(fx, u.email);
      expect(await sessionsRepository(fx.db.pool).countForUser(u.id)).toBe(1);
    });
  });

  describe('audit trail', () => {
    it('records login, failure, lockout and logout with the actor, and never a secret', async () => {
      const u = await makeUser(fx);
      for (let i = 0; i < 5; i++) await login(fx, u.email, WRONG);
      await q(fx, 'UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE id = ?', [
        u.id,
      ]);
      const s = await signIn(fx, u.email);
      await fx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: asUser(s, true) });

      const events = await auditLogRepository(fx.db.pool).listForEntity('user', u.id);
      expect(events.map((e) => e.event)).toEqual([
        ...Array<string>(5)
          .fill('auth.login_failed')
          .flatMap((e, i) => (i === 4 ? [e, 'auth.account_locked'] : [e])),
        'auth.login',
        'auth.logout',
      ]);
      expect(events.every((e) => e.actorUserId === u.id)).toBe(true);
      const raw = JSON.stringify(await q(fx, 'SELECT * FROM audit_log'));
      expect(raw).not.toContain(PASSWORD);
      expect(raw).not.toContain(WRONG);
      expect(raw).not.toMatch(/argon2/);
    });
    it('does not audit attempts on unknown emails (no attacker-controlled text is stored)', async () => {
      const probe = `probe-${uniqueEmail()}`;
      await login(fx, `${probe}@example.com`, WRONG);
      expect(JSON.stringify(await q(fx, 'SELECT * FROM audit_log'))).not.toContain(probe);
    });
  });
});

describe.skipIf(!hasTestDb)('login rate limit (real MariaDB)', () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await createAuthFixture({ LOGIN_RATE_LIMIT: '3' });
  });
  afterAll(async () => {
    await fx.close();
  });

  it('answers 429 with Retry-After after too many attempts from one IP, for any account', async () => {
    const u = await makeUser(fx);
    const codes: number[] = [];
    for (let i = 0; i < 3; i++)
      codes.push((await login(fx, `ghost${i}@example.com`, WRONG)).statusCode);
    expect(codes).toEqual([401, 401, 401]);

    const blocked = await login(fx, u.email); // correct password, still blocked
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(await sessionsRepository(fx.db.pool).countForUser(u.id)).toBe(0);
  });
});

describe.skipIf(!hasTestDb)('production cookie settings (real MariaDB)', () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await createAuthFixture({ NODE_ENV: 'production' });
  });
  afterAll(async () => {
    await fx.close();
  });

  it('uses the __Host- prefix, Secure, HttpOnly, SameSite=Lax and Path=/', async () => {
    const u = await makeUser(fx);
    const res = await login(fx, u.email);
    expect(res.cookies[0]).toMatchObject({
      name: '__Host-boq_session',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
    });
    expect(res.cookies[0]).not.toHaveProperty('domain');
  });
});

describe.skipIf(!hasTestDb)('logging hygiene (real MariaDB)', () => {
  let fx: Fixture;
  let output = '';
  beforeAll(async () => {
    const stream = new Writable({
      write(chunk, _enc, cb) {
        output += String(chunk);
        cb();
      },
    });
    fx = await createAuthFixture({ LOG_LEVEL: 'trace' }, { logStream: stream });
  });
  afterAll(async () => {
    await fx.close();
  });

  it('logs requests but never passwords, tokens, cookies or hashes', async () => {
    const u = await makeUser(fx, { roleName: 'Viewer' });
    await login(fx, u.email, WRONG);
    const s = await signIn(fx, u.email);
    await fx.app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser(s) });
    await fx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: asUser(s, true) });

    expect(output.length).toBeGreaterThan(200); // logging is really on
    expect(output).toContain('/api/auth/login');
    for (const secret of [PASSWORD, WRONG, s.token, s.csrf, 'argon2id']) {
      expect(output, `log leaked ${secret.slice(0, 6)}…`).not.toContain(secret);
    }
  });
});
