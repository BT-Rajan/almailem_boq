import { describe, expect, it } from 'vitest';
import { APPROVAL_STATUSES, type ApprovalStatus } from '@boq/shared';
import {
  canTransitionApproval,
  expenseStatusFor,
  INITIAL_APPROVAL_STATUS,
} from './approval-status';

describe('approval state machine', () => {
  it('allows exactly PENDING > APPROVED | REJECTED | CANCELLED', () => {
    const allowed = APPROVAL_STATUSES.flatMap((from) =>
      APPROVAL_STATUSES.filter((to) => canTransitionApproval(from, to)).map(
        (to) => `${from}>${to}`,
      ),
    );
    expect(allowed).toEqual(['PENDING>APPROVED', 'PENDING>REJECTED', 'PENDING>CANCELLED']);
  });

  it('starts pending, and every decision is final (so a second approve is refused)', () => {
    expect(INITIAL_APPROVAL_STATUS).toBe('PENDING');
    for (const done of ['APPROVED', 'REJECTED', 'CANCELLED'] as ApprovalStatus[]) {
      for (const to of APPROVAL_STATUSES) expect(canTransitionApproval(done, to)).toBe(false);
    }
  });

  it('only an approved request makes its expense count toward Actual', () => {
    expect(APPROVAL_STATUSES.map((s) => [s, expenseStatusFor(s)])).toEqual([
      ['PENDING', 'PENDING_APPROVAL'],
      ['APPROVED', 'POSTED'],
      ['REJECTED', 'REJECTED'],
      ['CANCELLED', 'CANCELLED'],
    ]);
  });
});
