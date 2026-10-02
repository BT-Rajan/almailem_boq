import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

/** Test files and test-support helpers (testing.ts) are not application code. */
const isTestCode = (f: string) => /\.test\.tsx?$/.test(f) || /(^|[\\/])testing\.ts$/.test(f);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('architecture: SQL lives only in repositories/ and db/', () => {
  const outside = files(SRC)
    .map((f) => relative(SRC, f))
    .filter((f) => f.endsWith('.ts') && !isTestCode(f))
    .filter((f) => !f.startsWith('repositories/') && !f.startsWith('db/'));

  it('has application code to check', () => {
    expect(outside.length).toBeGreaterThan(0);
  });

  it.each(outside)('%s imports no database driver and contains no SQL', (file) => {
    const text = readFileSync(join(SRC, file), 'utf8');
    expect(text).not.toMatch(/from ['"]mysql2/);
    expect(text).not.toMatch(
      /\b(SELECT\s.+\sFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i,
    );
  });
});

describe('architecture: access control goes through permissions only', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const appFiles = [SRC, join(REPO_ROOT, 'shared/src'), join(REPO_ROOT, 'frontend/src')]
    .flatMap((dir) => files(dir))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !isTestCode(f));
  const rel = (f: string) => relative(REPO_ROOT, f);

  it('has files to check', () => {
    expect(appFiles.length).toBeGreaterThan(10);
  });

  it('no code names a system role (roles are data; code checks permissions)', () => {
    const offenders = appFiles.filter((f) =>
      /['"`](Admin|Project Manager|Accountant|Viewer)['"`]/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  // User administration lists and assigns roles (by id) and is the one exception.
  const ROLE_ADMIN_SERVICE = 'services/user-admin.ts';

  it('role names are only readable inside the repositories, so no route can branch on them', () => {
    const offenders = appFiles
      .filter(
        (f) => !relative(SRC, f).startsWith('repositories/') && !relative(SRC, f).startsWith('db/'),
      )
      .filter((f) => relative(SRC, f) !== ROLE_ADMIN_SERVICE)
      .filter((f) =>
        /listRoleNames|userRolesRepository|rolesRepository/.test(readFileSync(f, 'utf8')),
      );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('the user-admin service never compares a role name', () => {
    const text = readFileSync(join(SRC, ROLE_ADMIN_SERVICE), 'utf8');
    expect(text).not.toMatch(/\.name\s*[!=]==|[!=]==\s*\w+\.name\b|roleName|findByName/);
  });

  it('only auth/guards.ts decides who may do what (no inline permission checks elsewhere)', () => {
    const offenders = appFiles
      .filter((f) => rel(f) !== 'backend/src/auth/guards.ts')
      .filter((f) => /permissions\.has\(|\.permissions\.includes\(/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('routes never read request.auth directly to make decisions; they use guards', () => {
    const routeFiles = appFiles.filter((f) => relative(SRC, f).startsWith('routes/'));
    for (const f of routeFiles)
      expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/\.auth\b|\.permissions\b/);
  });
});
