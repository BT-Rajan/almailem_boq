import type { Thresholds } from '@boq/shared';
import type { Db } from '../db/pool';
import { exec, selectOne, type Row } from '../db/sql';
import { strOrNull, toDate } from './shared';

export type ThresholdsRecord = Thresholds & { updatedAt: Date; updatedBy: string | null };

const map = (r: Row): ThresholdsRecord => ({
  warningBp: Number(r['warning_bp']),
  approvalBp: Number(r['approval_bp']),
  updatedAt: toDate(r['updated_at']),
  updatedBy: strOrNull(r, 'updated_by'),
});

/** The single budget_thresholds row (created by migration 0010). */
export function thresholdsRepository(db: Db) {
  return {
    async get(): Promise<ThresholdsRecord> {
      const row = await selectOne(db, 'SELECT * FROM budget_thresholds WHERE id = 1');
      if (!row) throw new Error('budget_thresholds row is missing; run the migrations');
      return map(row);
    },
    async lock(): Promise<ThresholdsRecord> {
      const row = await selectOne(db, 'SELECT * FROM budget_thresholds WHERE id = 1 FOR UPDATE');
      if (!row) throw new Error('budget_thresholds row is missing; run the migrations');
      return map(row);
    },
    async update(t: Thresholds, userId: string | null): Promise<void> {
      await exec(
        db,
        'UPDATE budget_thresholds SET warning_bp = ?, approval_bp = ?, updated_by = ? WHERE id = 1',
        [t.warningBp, t.approvalBp, userId],
      );
    },
  };
}
