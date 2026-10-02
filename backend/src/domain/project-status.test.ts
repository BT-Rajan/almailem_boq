import { describe, expect, it } from 'vitest';
import { PROJECT_STATUSES } from '@boq/shared';
import {
  INITIAL_PROJECT_STATUS,
  acceptsFinancialChanges,
  canTransition,
  nextStatuses,
} from './project-status';

describe('project status transitions', () => {
  it.each([
    ['planned', 'active', true],
    ['planned', 'cancelled', true],
    ['planned', 'completed', false],
    ['planned', 'on_hold', false],
    ['active', 'on_hold', true],
    ['active', 'completed', true],
    ['active', 'cancelled', true],
    ['active', 'planned', false],
    ['on_hold', 'active', true],
    ['on_hold', 'cancelled', true],
    ['on_hold', 'completed', false],
  ] as const)('%s -> %s is %s', (from, to, ok) => {
    expect(canTransition(from, to)).toBe(ok);
  });

  it('completed and cancelled are final; nothing moves to itself', () => {
    expect(nextStatuses('completed')).toEqual([]);
    expect(nextStatuses('cancelled')).toEqual([]);
    for (const s of PROJECT_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it('every status can be reached from the initial one', () => {
    const seen = new Set([INITIAL_PROJECT_STATUS]);
    const queue = [INITIAL_PROJECT_STATUS];
    for (let s = queue.shift(); s !== undefined; s = queue.shift()) {
      for (const n of nextStatuses(s)) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect([...seen].sort()).toEqual([...PROJECT_STATUSES].sort());
  });

  it('returns a copy, so callers cannot change the rules', () => {
    nextStatuses('active').push('planned');
    expect(nextStatuses('active')).not.toContain('planned');
  });
});

describe('acceptsFinancialChanges (budgets and spend)', () => {
  it.each([
    ['planned', true],
    ['active', true],
    ['on_hold', true],
    ['completed', false],
    ['cancelled', false],
  ] as const)('%s -> %s', (status, ok) => {
    expect(acceptsFinancialChanges(status)).toBe(ok);
  });
});
