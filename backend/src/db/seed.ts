import { readFile } from 'node:fs/promises';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { COST_HEADS_MAX, costHeadCodeSchema } from '@boq/shared';
import {
  costHeadsRepository,
  permissionsRepository,
  rolePermissionsRepository,
  rolesRepository,
} from '../repositories';
import { withTransaction } from './transaction';

/**
 * Seeds system roles, permissions and the role-permission mapping from database/seed/access.json.
 * Idempotent and additive: it never removes a permission someone granted by hand.
 * Users are never seeded.
 */
const seedSchema = z.object({
  permissions: z.array(z.object({ code: z.string().min(1), description: z.string() })).min(1),
  roles: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string(),
        grant: z.union([z.literal('all'), z.literal('all-except-admin'), z.array(z.string())]),
      }),
    )
    .min(1),
});
export type AccessSeed = z.infer<typeof seedSchema>;

export async function loadAccessSeed(file: string): Promise<AccessSeed> {
  return seedSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

function permissionsFor(grant: AccessSeed['roles'][number]['grant'], all: string[]): string[] {
  if (grant === 'all') return all;
  if (grant === 'all-except-admin') return all.filter((c) => !c.startsWith('admin.'));
  const unknown = grant.filter((c) => !all.includes(c));
  if (unknown.length) throw new Error(`Seed grants unknown permission(s): ${unknown.join(', ')}`);
  return grant;
}

export async function seedAccess(
  pool: Pool,
  seed: AccessSeed,
): Promise<{ roles: number; permissions: number }> {
  return withTransaction(pool, async (conn) => {
    const permissions = permissionsRepository(conn);
    const roles = rolesRepository(conn);
    const grants = rolePermissionsRepository(conn);

    const idByCode = new Map<string, string>();
    for (const p of seed.permissions) {
      idByCode.set(p.code, (await permissions.upsertByCode(p)).id);
    }
    const allCodes = [...idByCode.keys()];

    for (const r of seed.roles) {
      const role = await roles.upsertByName({
        name: r.name,
        description: r.description,
        isSystem: true,
      });
      for (const code of permissionsFor(r.grant, allCodes)) {
        await grants.grant(role.id, idByCode.get(code) as string);
      }
    }
    return { roles: seed.roles.length, permissions: seed.permissions.length };
  });
}

/**
 * Cost heads come from database/seed/cost-heads.json, in display order. The file holds data only;
 * no head is ever named in application code.
 */
const costHeadSeedSchema = z.object({
  costHeads: z
    .array(
      z.object({
        code: costHeadCodeSchema,
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).nullable().optional(),
      }),
    )
    .max(COST_HEADS_MAX)
    .refine(
      (heads) => new Set(heads.map((h) => h.code.toUpperCase())).size === heads.length,
      'Duplicate cost head code in seed file',
    ),
});
export type CostHeadSeed = z.infer<typeof costHeadSeedSchema>;

export async function loadCostHeadSeed(file: string): Promise<CostHeadSeed> {
  return costHeadSeedSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

/**
 * Add the heads whose code is not in the database yet, appended in file order. Idempotent.
 * Existing heads, including deleted ones, are left exactly as they are, so admin edits survive a re-seed.
 */
export async function seedCostHeads(
  pool: Pool,
  seed: CostHeadSeed,
): Promise<{ inserted: number; existing: number }> {
  return withTransaction(pool, async (conn) => {
    const heads = costHeadsRepository(conn);
    await heads.lockAllLive(); // one seed or reorder at a time, so display orders do not collide
    let inserted = 0;
    for (const h of seed.costHeads) {
      if (await heads.findByCode(h.code, { includeDeleted: true })) continue;
      await heads.create({
        code: h.code,
        name: h.name,
        description: h.description ?? null,
        displayOrder: await heads.nextDisplayOrder(),
      });
      inserted += 1;
    }
    return { inserted, existing: seed.costHeads.length - inserted };
  });
}
