import { readFile } from 'node:fs/promises';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { permissionsRepository, rolePermissionsRepository, rolesRepository } from '../repositories';

/**
 * Seeds system roles, permissions and the role-permission mapping from database/seed/access.json.
 * Idempotent and additive: it never removes a permission someone granted by hand.
 * It does NOT seed cost heads or users.
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
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
    await conn.commit();
    return { roles: seed.roles.length, permissions: seed.permissions.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
