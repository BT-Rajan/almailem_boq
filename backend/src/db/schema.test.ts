import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp } from './migrator';
import { MIGRATIONS_DIR } from './paths';
import { createTestDatabase, hasTestDb, type TestDatabase } from './testing';

const ALL_TABLES = [
  'users',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'projects',
  'project_members',
  'cost_heads',
  'audit_log',
];

describe.skipIf(!hasTestDb)('schema constraints (real MariaDB)', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
    await migrateUp(db.url, MIGRATIONS_DIR);
  });
  afterAll(async () => {
    await db.drop();
  });

  const q = async (sql: string, params: unknown[] = []) => {
    const [rows] = await db.pool.query<RowDataPacket[]>(sql, params);
    return rows;
  };
  const user = async (email: string) => {
    const rows = await q(
      "INSERT INTO users (email, name, password_hash) VALUES (?, 'n', 'h') RETURNING id",
      [email],
    );
    return String(rows[0]?.['id']);
  };
  const project = async (code: string, owner: string) => {
    const rows = await q(
      "INSERT INTO projects (code, name, owner_user_id, status) VALUES (?, 'p', ?, 's') RETURNING id",
      [code, owner],
    );
    return String(rows[0]?.['id']);
  };
  const columnsOf = async (table: string) =>
    (
      await q(
        'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
        [table],
      )
    ).map((r) => String(r['c']));

  describe('structure', () => {
    it('soft delete (deleted_at) exists only on users, projects and cost_heads', async () => {
      const withDeleted: string[] = [];
      for (const t of ALL_TABLES)
        if ((await columnsOf(t)).includes('deleted_at')) withDeleted.push(t);
      expect(withDeleted.sort()).toEqual(['cost_heads', 'projects', 'users']);
    });

    it('every table has created_at; entity tables also have updated_at', async () => {
      const entity = ['users', 'roles', 'permissions', 'projects', 'cost_heads'];
      for (const t of ALL_TABLES) {
        const cols = await columnsOf(t);
        expect(cols, t).toContain('created_at');
        expect(cols.includes('updated_at'), `${t} updated_at`).toBe(entity.includes(t));
      }
    });

    it('entity ids are native UUID columns', async () => {
      for (const t of ['users', 'roles', 'permissions', 'projects', 'cost_heads']) {
        const rows = await q(
          "SELECT column_type AS ct FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'id'",
          [t],
        );
        expect(String(rows[0]?.['ct']), t).toBe('uuid');
      }
    });

    it('every foreign key column is the first column of an index', async () => {
      const fks = await q(
        `SELECT table_name AS t, column_name AS c FROM information_schema.key_column_usage
         WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL`,
      );
      // role_permissions 2, user_roles 2, projects 1, project_members 2, audit_log 1
      expect(fks).toHaveLength(8);
      for (const fk of fks) {
        const idx = await q(
          `SELECT 1 FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? AND seq_in_index = 1`,
          [fk['t'], fk['c']],
        );
        expect(idx.length, `${fk['t']}.${fk['c']} has no index`).toBeGreaterThan(0);
      }
    });

    it('generates UUIDs and fills timestamps by default; updated_at moves on update', async () => {
      const id = await user('ts@x.com');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const before = (await q('SELECT updated_at AS u FROM users WHERE id = ?', [id]))[0]?.[
        'u'
      ] as Date;
      await new Promise((r) => setTimeout(r, 25));
      await q("UPDATE users SET name = 'changed' WHERE id = ?", [id]);
      const after = (await q('SELECT updated_at AS u FROM users WHERE id = ?', [id]))[0]?.[
        'u'
      ] as Date;
      expect(after.getTime()).toBeGreaterThan(before.getTime());
    });
  });

  describe('uniqueness', () => {
    it('user email is unique, case-insensitively', async () => {
      await user('dup@x.com');
      await expect(user('DUP@X.COM')).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });
    it('project code is unique', async () => {
      const owner = await user('owner1@x.com');
      await project('P-1', owner);
      await expect(project('P-1', owner)).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });
    it('cost head code is unique', async () => {
      await q("INSERT INTO cost_heads (code, name) VALUES ('CH-1', 'a')");
      await expect(
        q("INSERT INTO cost_heads (code, name) VALUES ('CH-1', 'b')"),
      ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });
    it('role name and permission code are unique', async () => {
      await q("INSERT INTO roles (name) VALUES ('R-x')");
      await expect(q("INSERT INTO roles (name) VALUES ('r-X')")).rejects.toMatchObject({
        code: 'ER_DUP_ENTRY',
      });
      await q("INSERT INTO permissions (code) VALUES ('a.b')");
      await expect(q("INSERT INTO permissions (code) VALUES ('a.b')")).rejects.toMatchObject({
        code: 'ER_DUP_ENTRY',
      });
    });
    it('link tables reject duplicate pairs', async () => {
      const owner = await user('owner2@x.com');
      const member = await user('member2@x.com');
      const pid = await project('P-2', owner);
      await q('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [pid, member]);
      await expect(
        q('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [pid, member]),
      ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });
  });

  describe('foreign keys', () => {
    const missing = '00000000-0000-1000-8000-000000000000';
    it('rejects references to rows that do not exist', async () => {
      await expect(project('P-bad', missing)).rejects.toMatchObject({
        code: 'ER_NO_REFERENCED_ROW_2',
      });
      await expect(
        q('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [missing, missing]),
      ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
      await expect(
        q('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [
          missing,
          missing,
        ]),
      ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
      await expect(
        q(
          "INSERT INTO audit_log (event, actor_user_id, entity_type, entity_id) VALUES ('e', ?, 't', '1')",
          [missing],
        ),
      ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
    });
    it('will not hard-delete a user that a project or role still references', async () => {
      const owner = await user('owner3@x.com');
      await project('P-3', owner);
      await expect(q('DELETE FROM users WHERE id = ?', [owner])).rejects.toMatchObject({
        code: 'ER_ROW_IS_REFERENCED_2',
      });
    });
    it('removes role_permissions when a role is deleted', async () => {
      const r = String(
        (await q("INSERT INTO roles (name) VALUES ('temp') RETURNING id"))[0]?.['id'],
      );
      const p = String(
        (await q("INSERT INTO permissions (code) VALUES ('temp.p') RETURNING id"))[0]?.['id'],
      );
      await q('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [r, p]);
      await q('DELETE FROM roles WHERE id = ?', [r]);
      expect(await q('SELECT 1 FROM role_permissions WHERE role_id = ?', [r])).toHaveLength(0);
    });
  });

  describe('audit_log is append-only', () => {
    it('accepts inserts with JSON payloads and a null (system) actor', async () => {
      await q(`INSERT INTO audit_log (event, actor_user_id, entity_type, entity_id, before_data, after_data)
               VALUES ('project.created', NULL, 'project', 'x', NULL, '{"code":"P"}')`);
      const rows = await q("SELECT after_data AS a FROM audit_log WHERE entity_id = 'x'");
      const raw = rows[0]?.['a'];
      expect(typeof raw === 'string' ? JSON.parse(raw) : raw).toEqual({ code: 'P' });
    });
    it('rejects UPDATE and DELETE at the database level', async () => {
      await expect(q("UPDATE audit_log SET event = 'tampered'")).rejects.toThrow(/append-only/);
      await expect(q('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
    });
    it('rejects invalid JSON', async () => {
      await expect(
        q(
          "INSERT INTO audit_log (event, entity_type, entity_id, after_data) VALUES ('e', 't', '1', 'not json')",
        ),
      ).rejects.toThrow();
    });
  });

  it('strict mode rejects over-long values instead of truncating', async () => {
    await expect(
      q("INSERT INTO cost_heads (code, name) VALUES (?, 'x')", ['C'.repeat(31)]),
    ).rejects.toThrow();
  });
});
