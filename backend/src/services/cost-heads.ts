import type { CostHead, CreateCostHeadInput, UpdateCostHeadInput } from '@boq/shared';
import { recordAudit, type AuditActor } from '../audit/record-audit';
import type { DbPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { AppError } from '../errors/app-error';
import { costHeadsRepository, type CostHeadRecord } from '../repositories';

/**
 * The cost-head master list. Heads are data managed here and seeded from database/seed;
 * no head is ever named in code. Heads are deactivated, never deleted (D18).
 */

const toCostHead = (h: CostHeadRecord): CostHead => ({
  id: h.id,
  systemNo: h.systemNo,
  code: h.code,
  name: h.name,
  description: h.description,
  displayOrder: h.displayOrder,
  active: h.active,
});

const FIELDS = ['code', 'name', 'description', 'active'] as const;

/** The reorder audit row describes the whole list, not one head. */
const LIST_ENTITY = { type: 'cost_head', id: 'list' };

export function createCostHeadService(pool: DbPool) {
  return {
    /** Every live head, active or not, in display order. */
    async list(): Promise<CostHead[]> {
      return (await costHeadsRepository(pool).list({ includeInactive: true })).map(toCostHead);
    },

    async create(actor: AuditActor, input: CreateCostHeadInput): Promise<CostHead> {
      return withTransaction(pool, async (tx) => {
        const heads = costHeadsRepository(tx);
        await heads.lockAllLive(); // serialise with reorder and other creates: no shared positions
        const head = await heads.create({
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          displayOrder: await heads.nextDisplayOrder(),
        });
        const after = toCostHead(head);
        await recordAudit(
          tx,
          'cost_head.created',
          actor,
          { type: 'cost_head', id: head.id },
          undefined,
          after,
        );
        return after;
      });
    },

    async update(actor: AuditActor, id: string, patch: UpdateCostHeadInput): Promise<CostHead> {
      return withTransaction(pool, async (tx) => {
        const heads = costHeadsRepository(tx);
        const current = await heads.findById(id);
        if (!current) throw AppError.notFound('Cost head not found');

        const changed = FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== current[f]);
        if (!changed.length) return toCostHead(current);

        const before = Object.fromEntries(changed.map((f) => [f, current[f]]));
        const after = Object.fromEntries(changed.map((f) => [f, patch[f]]));
        await heads.update(id, after);
        await recordAudit(tx, 'cost_head.updated', actor, { type: 'cost_head', id }, before, after);
        return toCostHead((await heads.findById(id)) as CostHeadRecord);
      });
    },

    /** `ids` must name every live head exactly once; anything else means the client's list is stale. */
    async reorder(actor: AuditActor, ids: readonly string[]): Promise<CostHead[]> {
      await withTransaction(pool, async (tx) => {
        const heads = costHeadsRepository(tx);
        const current = await heads.lockAllLive();
        const byId = new Map(current.map((h) => [h.id, h]));
        if (ids.length !== current.length || !ids.every((id) => byId.has(id))) {
          throw AppError.conflict('The cost head list has changed. Reload and try again.');
        }
        if (ids.every((id, i) => current[i]?.id === id)) return; // already in this order

        for (const [i, id] of ids.entries()) {
          if (byId.get(id)?.displayOrder !== i + 1) await heads.setDisplayOrder(id, i + 1);
        }
        await recordAudit(
          tx,
          'cost_head.reordered',
          actor,
          LIST_ENTITY,
          { order: current.map((h) => h.code) },
          { order: ids.map((id) => byId.get(id)?.code) },
        );
      });
      return this.list();
    },
  };
}
