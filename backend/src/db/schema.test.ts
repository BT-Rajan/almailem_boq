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
  'project_estimates',
  'expenses',
  'budget_thresholds',
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
  // Raw inserts bypass the repository, so they bring their own (unique, well-formed) system numbers.
  let seq = 0;
  const pNo = () => `P${String(++seq).padStart(5, '0')}`;
  const cNo = () => `C${String(++seq).padStart(3, '0')}`;
  const project = async (code: string, owner: string) => {
    const rows = await q(
      "INSERT INTO projects (system_no, code, name, owner_user_id, status) VALUES (?, ?, 'p', ?, 's') RETURNING id",
      [pNo(), code, owner],
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
      const entity = [
        'users',
        'roles',
        'permissions',
        'projects',
        'cost_heads',
        'project_estimates',
        'expenses',
        'budget_thresholds',
      ];
      for (const t of ALL_TABLES) {
        const cols = await columnsOf(t);
        expect(cols, t).toContain('created_at');
        expect(cols.includes('updated_at'), `${t} updated_at`).toBe(entity.includes(t));
      }
    });

    it('login lockout columns exist on users, and sessions store a token hash, not a token', async () => {
      expect(await columnsOf('users')).toEqual(
        expect.arrayContaining(['failed_login_count', 'locked_until']),
      );
      const cols = await columnsOf('sessions');
      expect(cols).toEqual(
        expect.arrayContaining(['token_hash', 'csrf_token', 'expires_at', 'last_seen_at']),
      );
      expect(cols).not.toContain('token');
    });

    it('entity ids are native UUID columns', async () => {
      for (const t of [
        'users',
        'roles',
        'permissions',
        'projects',
        'cost_heads',
        'sessions',
        'expenses',
      ]) {
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
      // role_permissions 2, user_roles 2, projects 1, project_members 2, audit_log 1, sessions 1,
      // project_estimates 2, expenses 4, budget_thresholds 1, approvals 4, approval_actions 2
      expect(fks).toHaveLength(22);
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
      await q("INSERT INTO cost_heads (system_no, code, name) VALUES (?, 'CH-1', 'a')", [cNo()]);
      await expect(
        q("INSERT INTO cost_heads (system_no, code, name) VALUES (?, 'CH-1', 'b')", [cNo()]),
      ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });
    it('system numbers are unique and well formed', async () => {
      const owner = await user('owner-sys@x.com');
      const no = pNo();
      await q(
        "INSERT INTO projects (system_no, code, name, owner_user_id, status) VALUES (?, 'S-1', 'p', ?, 's')",
        [no, owner],
      );
      await expect(
        q(
          "INSERT INTO projects (system_no, code, name, owner_user_id, status) VALUES (?, 'S-2', 'p', ?, 's')",
          [no, owner],
        ),
      ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
      for (const bad of ['P1', 'X00001', 'P0000A'])
        await expect(
          q(
            "INSERT INTO projects (system_no, code, name, owner_user_id, status) VALUES (?, ?, 'p', ?, 's')",
            [bad, `S-${bad}`, owner],
          ),
        ).rejects.toThrow();
      await expect(
        q("INSERT INTO cost_heads (system_no, code, name) VALUES ('C1', 'S-C', 'h')"),
      ).rejects.toThrow();
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

  describe('project_estimates', () => {
    const head = async (code: string) =>
      String(
        (
          await q(
            "INSERT INTO cost_heads (system_no, code, name) VALUES (?, ?, 'h') RETURNING id",
            [cNo(), code],
          )
        )[0]?.['id'],
      );

    it('one estimate per project and head; money is exact BIGINT and never negative', async () => {
      const p = await project('EST-1', await user('est1@x.com'));
      const h = await head('EH-1');
      const big = '9007199254740991'; // largest safe integer, in fils
      await q(
        'INSERT INTO project_estimates (project_id, cost_head_id, amount_fils) VALUES (?, ?, ?)',
        [p, h, big],
      );
      const rows = await q(
        'SELECT CAST(amount_fils AS CHAR) AS a FROM project_estimates WHERE project_id = ?',
        [p],
      );
      expect(rows[0]?.['a']).toBe(big);
      await expect(
        q(
          'INSERT INTO project_estimates (project_id, cost_head_id, amount_fils) VALUES (?, ?, 1)',
          [p, h],
        ),
      ).rejects.toThrow(/Duplicate/);
      const h2 = await head('EH-2');
      await expect(
        q(
          'INSERT INTO project_estimates (project_id, cost_head_id, amount_fils) VALUES (?, ?, -1)',
          [p, h2],
        ),
      ).rejects.toThrow(/ck_project_estimates_amount/);
    });

    it('rejects unknown projects and heads, and a referenced head cannot be hard-deleted', async () => {
      const p = await project('EST-2', await user('est2@x.com'));
      const h = await head('EH-3');
      const missing = '00000000-0000-1000-8000-000000000000';
      await expect(
        q(
          'INSERT INTO project_estimates (project_id, cost_head_id, amount_fils) VALUES (?, ?, 1)',
          [missing, h],
        ),
      ).rejects.toThrow(/foreign key/i);
      await expect(
        q(
          'INSERT INTO project_estimates (project_id, cost_head_id, amount_fils) VALUES (?, ?, 1)',
          [p, missing],
        ),
      ).rejects.toThrow(/foreign key/i);
      await q(
        'INSERT INTO project_estimates (project_id, cost_head_id, amount_fils) VALUES (?, ?, 1)',
        [p, h],
      );
      await expect(q('DELETE FROM cost_heads WHERE id = ?', [h])).rejects.toThrow(/foreign key/i);
    });
  });

  describe('expenses', () => {
    let p: string;
    let h: string;
    let u: string;
    beforeAll(async () => {
      u = await user('exp@x.com');
      p = await project('EXP-1', u);
      h = String(
        (
          await q(
            "INSERT INTO cost_heads (system_no, code, name) VALUES (?, 'XH-1', 'h') RETURNING id",
            [cNo()],
          )
        )[0]?.['id'],
      );
    });
    const add = async (
      vendor: string,
      invoice: string,
      amount: number,
      reversalOf: string | null = null,
    ) =>
      String(
        (
          await q(
            `INSERT INTO expenses (project_id, cost_head_id, vendor, invoice_no, expense_date, amount_fils, created_by, reversal_of)
             VALUES (?, ?, ?, ?, '2026-01-01', ?, ?, ?) RETURNING id`,
            [p, h, vendor, invoice, amount, u, reversalOf],
          )
        )[0]?.['id'],
      );

    it('blocks a duplicate vendor invoice in a project, regardless of case', async () => {
      await add('Acme Trading', 'INV-1', 100);
      await expect(add('ACME TRADING', 'inv-1', 5)).rejects.toThrow(/Duplicate/);
      await expect(add('Other Co', 'INV-1', 5)).resolves.toBeDefined();
    });

    it('a reversal may repeat the invoice; once reversed the invoice can be entered again', async () => {
      const original = await add('Beta', 'B-7', 100);
      await add('Beta', 'B-7', -100, original); // the reversal entry
      await expect(add('Beta', 'B-7', 90)).rejects.toThrow(/Duplicate/); // original still live
      await q('UPDATE expenses SET reversed_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [original]);
      await expect(add('Beta', 'B-7', 90)).resolves.toBeDefined();
    });

    it('originals are positive, reversals negative, and an expense is reversed at most once', async () => {
      await expect(add('Gamma', 'G-1', 0)).rejects.toThrow(/ck_expenses_amount_sign/);
      await expect(add('Gamma', 'G-2', -5)).rejects.toThrow(/ck_expenses_amount_sign/);
      const o = await add('Gamma', 'G-3', 50);
      await expect(add('Gamma', 'G-3', 50, o)).rejects.toThrow(/ck_expenses_amount_sign/);
      await add('Gamma', 'G-3', -50, o);
      await expect(add('Gamma', 'G-3', -50, o)).rejects.toThrow(/Duplicate/);
    });

    it('expenses cannot be hard-deleted while a reversal points at them', async () => {
      const o = await add('Delta', 'D-1', 10);
      await add('Delta', 'D-1', -10, o);
      await expect(q('DELETE FROM expenses WHERE id = ?', [o])).rejects.toThrow(/foreign key/i);
    });
  });

  describe('budget_thresholds', () => {
    it('ships with exactly one row holding the defaults', async () => {
      const rows = await q('SELECT id, warning_bp, approval_bp FROM budget_thresholds');
      expect(rows.map((r) => [r['id'], r['warning_bp'], r['approval_bp']])).toEqual([
        [1, 8000, 10000],
      ]);
    });
    it('refuses a second row and thresholds out of order or above 100%', async () => {
      await expect(
        q('INSERT INTO budget_thresholds (id, warning_bp, approval_bp) VALUES (2, 1, 2)'),
      ).rejects.toThrow(/ck_budget_thresholds_single_row/);
      for (const [w, a] of [
        [9000, 9000],
        [9500, 9000],
        [0, 9000],
        [8000, 10001],
      ])
        await expect(
          q('UPDATE budget_thresholds SET warning_bp = ?, approval_bp = ? WHERE id = 1', [w, a]),
        ).rejects.toThrow(/ck_budget_thresholds_order/);
    });
  });

  it('strict mode rejects over-long values instead of truncating', async () => {
    await expect(
      q("INSERT INTO cost_heads (system_no, code, name) VALUES (?, ?, 'x')", [
        cNo(),
        'C'.repeat(31),
      ]),
    ).rejects.toThrow();
  });
});
