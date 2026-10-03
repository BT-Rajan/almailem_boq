import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp } from '../db/migrator';
import { MIGRATIONS_DIR } from '../db/paths';
import { createTestDatabase, hasTestDb, type TestDatabase } from '../db/testing';
import {
  auditLogRepository,
  costHeadsRepository,
  permissionsRepository,
  projectMembersRepository,
  projectsRepository,
  rolePermissionsRepository,
  rolesRepository,
  userRolesRepository,
  usersRepository,
} from '.';

const MISSING = '00000000-0000-1000-8000-000000000000';

describe.skipIf(!hasTestDb)('repositories (real MariaDB)', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
    await migrateUp(db.url, MIGRATIONS_DIR);
  });
  afterAll(async () => {
    await db.drop();
  });

  const users = () => usersRepository(db.pool);
  const makeUser = (email: string) => users().create({ email, name: 'Test', passwordHash: 'hash' });

  describe('users', () => {
    it('creates, reads back and maps types', async () => {
      const u = await makeUser('a@x.com');
      expect(u.id).toHaveLength(36);
      expect(u).toMatchObject({ email: 'a@x.com', name: 'Test', disabled: false, deletedAt: null });
      expect(u.createdAt).toBeInstanceOf(Date);
      expect(await users().findById(u.id)).toEqual(u);
      expect((await users().findByEmail('A@X.COM'))?.id).toBe(u.id);
    });
    it('maps duplicate email to a conflict AppError without leaking the value', async () => {
      await makeUser('dup@x.com');
      const err = await makeUser('DUP@x.com').catch((e: unknown) => e);
      expect(err).toMatchObject({ code: 'CONFLICT', status: 409, message: 'User already exists' });
    });
    it('updates only whitelisted fields and reports misses', async () => {
      const u = await makeUser('upd@x.com');
      expect(await users().update(u.id, { name: 'New', disabled: true })).toBe(true);
      expect(await users().findById(u.id)).toMatchObject({ name: 'New', disabled: true });
      expect(await users().update(u.id, {})).toBe(false);
      expect(await users().update(MISSING, { name: 'x' })).toBe(false);
      // a field outside the map is ignored, never turned into SQL
      expect(await users().update(u.id, { email: 'hack@x.com' } as never)).toBe(false);
      expect((await users().findById(u.id))?.email).toBe('upd@x.com');
    });
    it('soft delete hides the user by default and keeps the email reserved', async () => {
      const u = await makeUser('gone@x.com');
      expect(await users().softDelete(u.id)).toBe(true);
      expect(await users().softDelete(u.id)).toBe(false);
      expect(await users().findById(u.id)).toBeNull();
      expect((await users().findById(u.id, { includeDeleted: true }))?.deletedAt).toBeInstanceOf(
        Date,
      );
      expect(await users().update(u.id, { name: 'zombie' })).toBe(false);
      await expect(makeUser('gone@x.com')).rejects.toMatchObject({ code: 'CONFLICT' });
    });
    it('works inside a transaction on a checked-out connection (rollback leaves nothing)', async () => {
      const conn = await db.pool.getConnection();
      await conn.beginTransaction();
      const u = await usersRepository(conn).create({
        email: 'tx@x.com',
        name: 'T',
        passwordHash: 'h',
      });
      await conn.rollback();
      conn.release();
      expect(await users().findById(u.id)).toBeNull();
    });
  });

  describe('projects and members', () => {
    it('creates with dates as plain strings and defaults to no financial fields', async () => {
      const owner = await makeUser('own@x.com');
      const p = await projectsRepository(db.pool).create({
        name: 'Tower',
        ownerUserId: owner.id,
        status: 'active',
        startDate: '2026-01-05',
        endDate: '2026-12-31',
      });
      expect(p).toMatchObject({
        systemNo: expect.stringMatching(/^P\d{5}$/),
        startDate: '2026-01-05',
        endDate: '2026-12-31',
        description: null,
      });
      expect(Object.keys(p).filter((k) => /amount|budget|cost|fils/i.test(k))).toEqual([]);
    });
    it('maps an unknown owner to an AppError', async () => {
      await expect(
        projectsRepository(db.pool).create({ name: 'c', ownerUserId: MISSING, status: 's' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
    it('updates, finds by id and soft deletes', async () => {
      const owner = await makeUser('own3@x.com');
      const repo = projectsRepository(db.pool);
      const p = await repo.create({
        name: 'a',
        ownerUserId: owner.id,
        status: 'planning',
      });
      expect(
        await repo.update(p.id, { status: 'active', endDate: '2027-01-01', description: 'd' }),
      ).toBe(true);
      expect(await repo.findById(p.id)).toMatchObject({
        status: 'active',
        endDate: '2027-01-01',
        description: 'd',
      });
      expect(await repo.softDelete(p.id)).toBe(true);
      expect(await repo.findById(p.id)).toBeNull();
      expect(await repo.findById(p.id, { includeDeleted: true })).not.toBeNull();
    });
    it('adds, lists, checks and removes members; duplicates conflict', async () => {
      const owner = await makeUser('own4@x.com');
      const member = await makeUser('mem4@x.com');
      const p = await projectsRepository(db.pool).create({
        name: 'a',
        ownerUserId: owner.id,
        status: 's',
      });
      const members = projectMembersRepository(db.pool);
      expect(await members.isMember(p.id, member.id)).toBe(false);
      await members.add(p.id, member.id);
      expect(await members.isMember(p.id, member.id)).toBe(true);
      expect(await members.listUserIds(p.id)).toEqual([member.id]);
      await expect(members.add(p.id, member.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(members.add(p.id, MISSING)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await members.remove(p.id, member.id)).toBe(true);
      expect(await members.remove(p.id, member.id)).toBe(false);
    });
  });

  describe('cost heads', () => {
    const repo = () => costHeadsRepository(db.pool);
    it('lists live active heads in display order; inactive only on request', async () => {
      const b = await repo().create({ code: 'T-B', name: 'B', displayOrder: 2 });
      await repo().create({ code: 'T-A', name: 'A', displayOrder: 1 });
      const off = await repo().create({ code: 'T-C', name: 'C', displayOrder: 3, active: false });
      const gone = await repo().create({ code: 'T-D', name: 'D', displayOrder: 4 });
      await repo().softDelete(gone.id);

      const codes = (await repo().list()).map((h) => h.code).filter((c) => c.startsWith('T-'));
      expect(codes).toEqual(['T-A', 'T-B']);
      const all = (await repo().list({ includeInactive: true }))
        .map((h) => h.code)
        .filter((c) => c.startsWith('T-'));
      expect(all).toEqual(['T-A', 'T-B', 'T-C']);
      expect(off.active).toBe(false);
      expect(b.description).toBeNull();
    });
    it('rejects duplicate codes; updates and soft deletes', async () => {
      const h = await repo().create({ code: 'U-1', name: 'x' });
      await expect(repo().create({ code: 'U-1', name: 'y' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(await repo().update(h.id, { name: 'renamed', active: false, displayOrder: 9 })).toBe(
        true,
      );
      expect(await repo().findByCode('U-1')).toMatchObject({
        name: 'renamed',
        active: false,
        displayOrder: 9,
      });
      expect(await repo().softDelete(h.id)).toBe(true);
      expect(await repo().findById(h.id)).toBeNull();
    });
  });

  describe('roles, permissions and assignments', () => {
    it('upserts are idempotent and refresh descriptions', async () => {
      const roles = rolesRepository(db.pool);
      const first = await roles.upsertByName({
        name: 'Tester',
        description: 'one',
        isSystem: true,
      });
      const again = await roles.upsertByName({
        name: 'Tester',
        description: 'two',
        isSystem: true,
      });
      expect(again.id).toBe(first.id);
      expect(again.description).toBe('two');
      const perms = permissionsRepository(db.pool);
      const p1 = await perms.upsertByCode({ code: 'x.y', description: 'a' });
      const p2 = await perms.upsertByCode({ code: 'x.y', description: 'b' });
      expect(p2.id).toBe(p1.id);
      expect((await perms.findByCode('x.y'))?.description).toBe('b');
    });
    it('grants idempotently, revokes, and assigns roles to users', async () => {
      const role = await rolesRepository(db.pool).upsertByName({
        name: 'Grantee',
        isSystem: false,
      });
      const perm = await permissionsRepository(db.pool).upsertByCode({ code: 'g.one' });
      const rp = rolePermissionsRepository(db.pool);
      await rp.grant(role.id, perm.id);
      await rp.grant(role.id, perm.id);
      expect(await rp.listPermissionCodes(role.id)).toEqual(['g.one']);
      expect(await rp.revoke(role.id, perm.id)).toBe(true);
      expect(await rp.listPermissionCodes(role.id)).toEqual([]);

      const u = await makeUser('roleuser@x.com');
      const ur = userRolesRepository(db.pool);
      await ur.assign(u.id, role.id);
      expect(await ur.listRoleNames(u.id)).toEqual(['Grantee']);
      await expect(ur.assign(u.id, role.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await ur.remove(u.id, role.id)).toBe(true);
    });
  });

  describe('audit log', () => {
    it('appends entries with before/after JSON and reads them back in order', async () => {
      const actor = await makeUser('actor@x.com');
      const audit = auditLogRepository(db.pool);
      const id1 = await audit.append({
        event: 'project.created',
        actorUserId: actor.id,
        entityType: 'project',
        entityId: 'e1',
        after: { code: 'P' },
      });
      const id2 = await audit.append({
        event: 'project.updated',
        actorUserId: null,
        entityType: 'project',
        entityId: 'e1',
        before: { n: 1 },
        after: { n: 2 },
      });
      expect(id2).toBeGreaterThan(id1);
      const list = await audit.listForEntity('project', 'e1');
      expect(list.map((e) => e.event)).toEqual(['project.created', 'project.updated']);
      expect(list[0]).toMatchObject({ actorUserId: actor.id, before: null, after: { code: 'P' } });
      expect(list[1]).toMatchObject({ actorUserId: null, before: { n: 1 }, after: { n: 2 } });
    });
    it('has no update or delete method, and rejects an unknown actor', async () => {
      const audit = auditLogRepository(db.pool);
      expect(Object.keys(audit).sort()).toEqual(['append', 'listForEntity']);
      await expect(
        audit.append({ event: 'e', actorUserId: MISSING, entityType: 't', entityId: '1' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });
});
