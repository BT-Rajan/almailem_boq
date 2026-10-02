import type { ThresholdSettings, Thresholds } from '@boq/shared';
import { recordAudit, type AuditActor } from '../audit/record-audit';
import type { DbPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { checkThresholds } from '../domain/control';
import { thresholdsRepository, type ThresholdsRecord } from '../repositories';

/** Admin > Approval Rules: read and change the one thresholds row. The control engine interprets them. */

const toSettings = (r: ThresholdsRecord): ThresholdSettings => ({
  warningBp: r.warningBp,
  approvalBp: r.approvalBp,
  updatedAt: r.updatedAt.toISOString(),
  updatedBy: r.updatedBy,
});

export function createThresholdService(pool: DbPool) {
  return {
    async get(): Promise<ThresholdSettings> {
      return toSettings(await thresholdsRepository(pool).get());
    },

    /** `input` must already be validated with thresholdsSchema. */
    async update(actor: AuditActor, input: Thresholds): Promise<ThresholdSettings> {
      const t = checkThresholds(input);
      return withTransaction(pool, async (tx) => {
        const repo = thresholdsRepository(tx);
        const current = await repo.lock();
        if (current.warningBp !== t.warningBp || current.approvalBp !== t.approvalBp) {
          await repo.update(t, actor?.userId ?? null);
          await recordAudit(
            tx,
            'budget_thresholds.updated',
            actor,
            { type: 'budget_thresholds', id: '1' },
            { warningBp: current.warningBp, approvalBp: current.approvalBp },
            { warningBp: t.warningBp, approvalBp: t.approvalBp },
          );
        }
        return toSettings(await repo.get());
      });
    },
  };
}
