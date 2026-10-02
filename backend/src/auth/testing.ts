import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CSRF_HEADER } from '@boq/shared';
import { buildApp, type AppDeps } from '../app';
import { loadEnv } from '../config/env';
import { migrateUp } from '../db/migrator';
import { ACCESS_SEED_FILE, MIGRATIONS_DIR } from '../db/paths';
import { loadAccessSeed, seedAccess } from '../db/seed';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import {
  rolesRepository,
  userRolesRepository,
  usersRepository,
  type UserRecord,
} from '../repositories';
import { hashPassword } from './passwords';

export const PASSWORD = 'correct-horse-battery-staple';
export const ALLOWED_ORIGIN = 'http://localhost:5173';

export type Fixture = {
  db: TestDatabase;
  app: FastifyInstance;
  close: () => Promise<void>;
};

/** A migrated, seeded throwaway database plus an app wired to it. `extend` may add routes before ready(). */
export async function createAuthFixture(
  envOverrides: Record<string, string> = {},
  deps: Omit<AppDeps, 'pool'> = {},
  extend?: (app: FastifyInstance) => void,
): Promise<Fixture> {
  const db = await createTestDatabase();
  await migrateUp(db.url, MIGRATIONS_DIR);
  await seedAccess(db.pool, await loadAccessSeed(ACCESS_SEED_FILE));
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LOGIN_RATE_LIMIT: '10000',
    ...envOverrides,
  });
  const app = await buildApp(env, { ...deps, pool: db.pool });
  extend?.(app);
  await app.ready();
  return {
    db,
    app,
    close: async () => {
      await app.close();
      await db.drop();
    },
  };
}

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${++counter}@example.com`;

export async function makeUser(
  fx: Fixture,
  opts: { email?: string; roleName?: string; password?: string } = {},
): Promise<UserRecord> {
  const user = await usersRepository(fx.db.pool).create({
    email: opts.email ?? uniqueEmail(),
    name: 'Test User',
    passwordHash: await hashPassword(opts.password ?? PASSWORD),
  });
  if (opts.roleName) {
    const role = await rolesRepository(fx.db.pool).findByName(opts.roleName);
    await userRolesRepository(fx.db.pool).assign(user.id, role?.id as string);
  }
  return user;
}

export const login = (
  fx: Fixture,
  email: string,
  password = PASSWORD,
  headers: Record<string, string> = {},
) =>
  fx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password }, headers });

export type Session = { cookie: string; token: string; csrf: string; res: LightMyRequestResponse };

export async function signIn(fx: Fixture, email: string, password = PASSWORD): Promise<Session> {
  const res = await login(fx, email, password);
  const c = res.cookies[0];
  if (res.statusCode !== 200 || !c)
    throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  return { cookie: `${c.name}=${c.value}`, token: c.value, csrf: res.json().data.csrfToken, res };
}

export const asUser = (s: Session, withCsrf = false): Record<string, string> => ({
  cookie: s.cookie,
  ...(withCsrf && { [CSRF_HEADER]: s.csrf }),
});
