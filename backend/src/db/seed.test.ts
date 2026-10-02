import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_CODES } from '@boq/shared';
import {
  costHeadsRepository,
  permissionsRepository,
  rolePermissionsRepository,
  rolesRepository,
} from '../repositories';
import { migrateUp } from './migrator';
import { ACCESS_SEED_FILE, MIGRATIONS_DIR } from './paths';
import { loadAccessSeed, seedAccess } from './seed';
import { createTestDatabase, hasTestDb, type TestDatabase } from './testing';

it('the seed file lists exactly the permission codes the code knows about', async () => {
  const seed = await loadAccessSeed(ACCESS_SEED_FILE);
  expect(seed.permissions.map((p) => p.code).sort()).toEqual([...PERMISSION_CODES].sort());
});

describe.skipIf(!hasTestDb)('access seed (real MariaDB)', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
    await migrateUp(db.url, MIGRATIONS_DIR);
  });
  afterAll(async () => {
    await db.drop();
  });

  const codesFor = async (roleName: string) => {
    const role = await rolesRepository(db.pool).findByName(roleName);
    return rolePermissionsRepository(db.pool).listPermissionCodes(role?.id as string);
  };
  const snapshot = async () => ({
    roles: (await rolesRepository(db.pool).list()).map((r) => [r.id, r.name]),
    permissions: (await permissionsRepository(db.pool).list()).map((p) => [p.id, p.code]),
    grants: {
      Admin: await codesFor('Admin'),
      'Project Manager': await codesFor('Project Manager'),
      Accountant: await codesFor('Accountant'),
      Viewer: await codesFor('Viewer'),
    },
  });

  it('seeds the four system roles, the DOMAIN.md permissions and the mapping', async () => {
    const seed = await loadAccessSeed(ACCESS_SEED_FILE);
    expect(await seedAccess(db.pool, seed)).toEqual({ roles: 4, permissions: 18 });

    const roles = await rolesRepository(db.pool).list();
    expect(roles.map((r) => r.name)).toEqual(['Accountant', 'Admin', 'Project Manager', 'Viewer']);
    expect(roles.every((r) => r.isSystem)).toBe(true);
    expect(await permissionsRepository(db.pool).list()).toHaveLength(18);

    expect(await codesFor('Admin')).toHaveLength(18);
    expect(await codesFor('Project Manager')).toHaveLength(13);
    expect(await codesFor('Accountant')).toEqual(await codesFor('Project Manager'));
    expect((await codesFor('Accountant')).some((c) => c.startsWith('admin.'))).toBe(false);
    expect(await codesFor('Viewer')).toEqual(['expense.view', 'project.view', 'report.view']);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const before = await snapshot();
    await seedAccess(db.pool, await loadAccessSeed(ACCESS_SEED_FILE));
    await seedAccess(db.pool, await loadAccessSeed(ACCESS_SEED_FILE));
    expect(await snapshot()).toEqual(before);
  });

  it('is additive: keeps grants made by hand and restores edited descriptions', async () => {
    const viewer = await rolesRepository(db.pool).findByName('Viewer');
    const extra = await permissionsRepository(db.pool).findByCode('report.export');
    await rolePermissionsRepository(db.pool).grant(viewer?.id as string, extra?.id as string);
    await db.pool.query(
      "UPDATE permissions SET description = 'edited' WHERE code = 'project.view'",
    );

    await seedAccess(db.pool, await loadAccessSeed(ACCESS_SEED_FILE));

    expect(await codesFor('Viewer')).toContain('report.export');
    expect((await permissionsRepository(db.pool).findByCode('project.view'))?.description).not.toBe(
      'edited',
    );
  });

  it('does not seed cost heads', async () => {
    expect(await costHeadsRepository(db.pool).list({ includeInactive: true })).toEqual([]);
  });

  it('rolls back and reports a grant to an unknown permission', async () => {
    const bad = {
      permissions: [{ code: 'only.one', description: 'x' }],
      roles: [{ name: 'Broken', description: 'x', grant: ['nope'] }],
    };
    await expect(seedAccess(db.pool, bad)).rejects.toThrow(/unknown permission/);
    expect(await rolesRepository(db.pool).findByName('Broken')).toBeNull();
    expect(await permissionsRepository(db.pool).findByCode('only.one')).toBeNull();
  });
});
