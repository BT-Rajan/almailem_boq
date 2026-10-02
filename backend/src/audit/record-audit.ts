import type { Db } from '../db/pool';
import { auditLogRepository } from '../repositories';

/** null = the system acted (no signed-in user). */
export type AuditActor = { userId: string } | null;
export type AuditEntity = { type: string; id: string };

const EVENT_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/; // e.g. project.created, auth.login_failed
const SENSITIVE_KEY = /pass(word)?|token|secret|hash|cookie|authorization/i;
const MAX_DEPTH = 6;

/** Copy of `value` with the contents of sensitive-looking keys replaced. Audit rows must never hold secrets. */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? '[redacted]' : redactSensitive(v, depth + 1),
      ]),
    );
  }
  return value;
}

/**
 * Append one business event to the audit log. This is the only way application code writes to it.
 * Pass a transaction connection as `db` so the audit row commits or rolls back with the change it records.
 */
export function recordAudit(
  db: Db,
  event: string,
  actor: AuditActor,
  entity: AuditEntity,
  before?: unknown,
  after?: unknown,
): Promise<number> {
  if (!EVENT_NAME.test(event)) throw new Error(`Invalid audit event name: ${event}`);
  return auditLogRepository(db).append({
    event,
    actorUserId: actor?.userId ?? null,
    entityType: entity.type,
    entityId: entity.id,
    before: before === undefined ? undefined : redactSensitive(before),
    after: after === undefined ? undefined : redactSensitive(after),
  });
}
