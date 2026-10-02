import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_CODES } from '@boq/shared';
import {
  costHeadsRepository,
  permissionsRepository,
  rolePermissionsRepository,
  rolesRepository,
} from '../repositories';
import { migrateUp } from './migrator';
import { ACCESS_SEED_FILE, COST_HEADS_SEED_FILE, MIGRATIONS_DIR } from './paths';
import { loadAccessSeed, loadCostHeadSeed, seedAccess, seedCostHeads } from './seed';
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
    expect(await seedAccess(db.pool, seed)).toEqual({ roles: 4, permissions: 19 });

    const roles = await rolesRepository(db.pool).list();
    expect(roles.map((r) => r.name)).toEqual(['Accountant', 'Admin', 'Project Manager', 'Viewer']);
    expect(roles.every((r) => r.isSystem)).toBe(true);
    expect(await permissionsRepository(db.pool).list()).toHaveLength(19);

    expect(await codesFor('Admin')).toHaveLength(19);
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

describe('cost head seed file', () => {
  it('the shipped file is valid', async () => {
    await expect(loadCostHeadSeed(COST_HEADS_SEED_FILE)).resolves.toBeDefined();
  });
  it('rejects duplicate codes (case-insensitive) and bad codes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boq-seed-'));
    const write = async (heads: unknown) => {
      const f = join(dir, `${Math.random()}.json`);
      await writeFile(f, JSON.stringify({ costHeads: heads }));
      return f;
    };
    const dup = await write([
      { code: 'a1', name: 'x' },
      { code: 'A1', name: 'y' },
    ]);
    await expect(loadCostHeadSeed(dup)).rejects.toThrow(/Duplicate/);
    await expect(loadCostHeadSeed(await write([{ code: '%%', name: 'x' }]))).rejects.toThrow();
    await rm(dir, { recursive: true });
  });
});

describe.skipIf(!hasTestDb)('cost head seed (real MariaDB)', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
    await migrateUp(db.url, MIGRATIONS_DIR);
  });
  afterAll(async () => {
    await db.drop();
  });
  // Placeholder data, not real cost heads.
  const seed = {
    costHeads: [
      { code: 'S1', name: 'Seed one', description: 'd' },
      { code: 'S2', name: 'Seed two' },
    ],
  };

  it('inserts in file order, is idempotent, and never overwrites admin edits', async () => {
    expect(await seedCostHeads(db.pool, seed)).toEqual({ inserted: 2, existing: 0 });
    const heads = costHeadsRepository(db.pool);
    expect((await heads.list()).map((h) => [h.code, h.displayOrder])).toEqual([
      ['S1', 1],
      ['S2', 2],
    ]);
    const s1 = await heads.findByCode('S1');
    await heads.update(s1?.id as string, { name: 'Edited by admin', active: false });

    const more = { costHeads: [...seed.costHeads, { code: 'S3', name: 'Seed three' }] };
    expect(await seedCostHeads(db.pool, more)).toEqual({ inserted: 1, existing: 2 });
    expect(await heads.findByCode('S1')).toMatchObject({ name: 'Edited by admin', active: false });
    expect((await heads.findByCode('S3'))?.displayOrder).toBe(3);
  });
});
