import { describe, expect, it } from 'vitest';
import { fils, MoneyError } from '@boq/shared';
import { budgetMetrics, totalMetrics, utilisationBp } from './metrics';

const m = (budget: number, actual: number) =>
  budgetMetrics({ budget: fils(budget), actual: fils(actual) });

describe('budgetMetrics', () => {
  it('normal case', () => {
    expect(m(1_000_000, 250_000)).toEqual({
      budget: 1_000_000,
      actual: 250_000,
      remaining: 750_000,
      utilisationBp: 2500,
    });
  });

  it('zero actual', () => {
    expect(m(5_000, 0)).toEqual({ budget: 5_000, actual: 0, remaining: 5_000, utilisationBp: 0 });
  });

  it('zero budget, zero actual is 0%', () => {
    expect(m(0, 0)).toEqual({ budget: 0, actual: 0, remaining: 0, utilisationBp: 0 });
  });

  it('zero budget with any spend counts as 100% (D3)', () => {
    expect(m(0, 1)).toEqual({ budget: 0, actual: 1, remaining: -1, utilisationBp: 10_000 });
    expect(m(0, 9_000_000)).toMatchObject({ remaining: -9_000_000, utilisationBp: 10_000 });
  });

  it('actual above budget: negative remaining, utilisation over 100%', () => {
    expect(m(1_000, 1_500)).toEqual({
      budget: 1_000,
      actual: 1_500,
      remaining: -500,
      utilisationBp: 15_000,
    });
  });

  it('exactly at budget is exactly 100%', () => {
    expect(m(123_457, 123_457).utilisationBp).toBe(10_000);
  });

  it('rounds down, so values just under a whole basis point never round up into it', () => {
    // 79.999...% must stay below 80.00%
    expect(m(100_000_000, 79_999_999).utilisationBp).toBe(7999);
    expect(m(100_000_000, 80_000_000).utilisationBp).toBe(8000);
    expect(m(3, 2).utilisationBp).toBe(6666); // 66.666...%
    expect(m(3, 1).utilisationBp).toBe(3333);
  });

  it('is exact for the largest fils values (no float overflow)', () => {
    const max = Number.MAX_SAFE_INTEGER; // ~9 trillion KWD
    expect(m(max, max)).toMatchObject({ remaining: 0, utilisationBp: 10_000 });
    expect(m(max, max - 1).utilisationBp).toBe(9999);
    expect(m(max, 1).utilisationBp).toBe(0);
    // utilisation itself would be beyond the safe range: clamped, still a safe integer
    expect(m(1, max).utilisationBp).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(m(1, max).utilisationBp)).toBe(true);
  });

  it('negative actual (net reversals) rounds down, not toward zero', () => {
    expect(m(3, -1)).toMatchObject({ remaining: 4, utilisationBp: -3334 });
  });

  it('refuses a negative budget and unsafe results', () => {
    expect(() => m(-1, 0)).toThrow(RangeError);
    expect(() => m(Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER)).toThrow(MoneyError);
  });

  it('never returns floats', () => {
    for (const [b, a] of [
      [7, 3],
      [1_000_003, 999_999],
      [0, 5],
    ] as const) {
      const r = m(b, a);
      for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('utilisationBp', () => {
  it('matches the exact integer comparison actual*10000 >= T*budget at every boundary', () => {
    const budget = fils(1_234_567);
    for (const actual of [0, 987_652, 987_653, 1_234_566, 1_234_567, 1_234_568]) {
      const bp = utilisationBp(budget, fils(actual));
      for (const t of [8000, 10_000]) {
        expect(bp >= t).toBe(BigInt(actual) * 10_000n >= BigInt(t) * BigInt(budget));
      }
    }
  });
});

describe('totalMetrics', () => {
  it('sums budgets and actuals, then measures the total as one (not an average of percentages)', () => {
    const rows = [
      { budget: fils(1_000), actual: fils(900) }, // 90%
      { budget: fils(9_000), actual: fils(0) }, // 0%
    ];
    expect(totalMetrics(rows)).toEqual({
      budget: 10_000,
      actual: 900,
      remaining: 9_100,
      utilisationBp: 900,
    });
  });

  it('total remaining equals the sum of head remainings', () => {
    const rows = [
      { budget: fils(5_000), actual: fils(6_000) },
      { budget: fils(0), actual: fils(10) },
      { budget: fils(7_777), actual: fils(1) },
    ];
    const heads = rows.map((r) => budgetMetrics(r));
    const total = totalMetrics(rows);
    expect(total.remaining).toBe(heads.reduce((s, h) => s + h.remaining, 0));
    expect(total.budget).toBe(heads.reduce((s, h) => s + h.budget, 0));
    expect(total.actual).toBe(heads.reduce((s, h) => s + h.actual, 0));
  });

  it('no heads: all zero', () => {
    expect(totalMetrics([])).toEqual({ budget: 0, actual: 0, remaining: 0, utilisationBp: 0 });
  });
});
