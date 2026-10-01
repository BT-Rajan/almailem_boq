import type { Db } from '../db/pool';
import { exec, selectRows, type Row } from '../db/sql';
import { guarded } from '../db/errors';
import { str, toDate } from './shared';

/** Append-only. There is deliberately no update or delete method (the database also forbids both). */
export type AuditRecord = {
  id: number;
  event: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
};
export type NewAuditEntry = {
  event: string;
  actorUserId: string | null; // null = system
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

const parseJson = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : (v ?? null));
const toJson = (v: unknown): string | null =>
  v === undefined || v === null ? null : JSON.stringify(v);

const map = (r: Row): AuditRecord => ({
  id: Number(r['id']),
  event: str(r, 'event'),
  actorUserId: r['actor_user_id'] === null ? null : str(r, 'actor_user_id'),
  entityType: str(r, 'entity_type'),
  entityId: str(r, 'entity_id'),
  before: parseJson(r['before_data']),
  after: parseJson(r['after_data']),
  createdAt: toDate(r['created_at']),
});

export function auditLogRepository(db: Db) {
  return {
    async append(entry: NewAuditEntry): Promise<number> {
      const res = await guarded('Audit entry', () =>
        exec(
          db,
          `INSERT INTO audit_log (event, actor_user_id, entity_type, entity_id, before_data, after_data)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            entry.event,
            entry.actorUserId,
            entry.entityType,
            entry.entityId,
            toJson(entry.before),
            toJson(entry.after),
          ],
        ),
      );
      return res.insertId;
    },
    async listForEntity(entityType: string, entityId: string): Promise<AuditRecord[]> {
      const rows = await selectRows(
        db,
        'SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id',
        [entityType, entityId],
      );
      return rows.map(map);
    },
  };
}
