import { describe, expect, it } from 'vitest';
import { fils, MoneyError, type BudgetStatus, type Thresholds } from '@boq/shared';
import { byUrgency, calculateBudgetStatus, checkThresholds, projectedStatus } from './control';
import { budgetMetrics, utilisationBp } from './metrics';

// The shipped defaults (database migration 0010): warning at 80.00%, approval at 100.00%.
const DEFAULTS: Thresholds = { warningBp: 8000, approvalBp: 10000 };
const RANK: Record<BudgetStatus, number> = { NORMAL: 0, WARNING: 1, APPROVAL_REQUIRED: 2 };

/** The status by exact rational comparison, independent of the engine: actual/budget >= t/10000. */
function exactStatus(budget: bigint, actual: bigint, t: Thresholds): BudgetStatus {
  if (budget === 0n) return actual > 0n ? 'APPROVAL_REQUIRED' : 'NORMAL';
  const reaches = (bp: number) => actual * 10_000n >= BigInt(bp) * budget;
  if (reaches(t.approvalBp)) return 'APPROVAL_REQUIRED';
  if (reaches(t.warningBp)) return 'WARNING';
  return 'NORMAL';
}
const statusFor = (budget: number, actual: number, t = DEFAULTS) =>
  calculateBudgetStatus(
    budgetMetrics({ budget: fils(budget), actual: fils(actual) }).utilisationBp,
    t,
  );

describe('calculateBudgetStatus: the named boundaries', () => {
  it.each([
    [0, 'NORMAL'],
    [1, 'NORMAL'],
    [7999, 'NORMAL'], // 79.99%
    [8000, 'WARNING'], // 80.00%
    [8001, 'WARNING'],
    [9999, 'WARNING'], // 99.99%
    [10000, 'APPROVAL_REQUIRED'], // 100.00%
    [10001, 'APPROVAL_REQUIRED'], // 100.01%
    [15000, 'APPROVAL_REQUIRED'],
    [Number.MAX_SAFE_INTEGER, 'APPROVAL_REQUIRED'],
    [-1, 'NORMAL'], // net reversals
    [-Number.MAX_SAFE_INTEGER, 'NORMAL'],
  ] as const)('%i bp -> %s', (bp, status) => {
    expect(calculateBudgetStatus(bp, DEFAULTS)).toBe(status);
  });

  // Same boundaries, reached from real money: budget 100,000.000 KWD.
  it.each([
    [79_990_000, 'NORMAL'], // 79.99%
    [79_999_999, 'NORMAL'], // 79.9999...% must not round up into WARNING
    [80_000_000, 'WARNING'], // 80.00%
    [99_990_000, 'WARNING'], // 99.99%
    [99_999_999, 'WARNING'], // one fils short of the budget
    [100_000_000, 'APPROVAL_REQUIRED'], // 100.00%
    [100_010_000, 'APPROVAL_REQUIRED'], // 100.01%
  ] as const)('budget 100,000.000 KWD, actual %i fils -> %s', (actual, status) => {
    expect(statusFor(100_000_000, actual)).toBe(status);
  });

  it('flips at exactly the smallest actual that reaches each threshold, for awkward budgets', () => {
    for (const budget of [1, 3, 7, 999, 1_234_567, 7_777_777_777, Number.MAX_SAFE_INTEGER]) {
      const b = BigInt(budget);
      for (const [bp, status] of [
        [8000, 'WARNING'],
        [10000, 'APPROVAL_REQUIRED'],
      ] as const) {
        const first = Number((BigInt(bp) * b + 9_999n) / 10_000n); // ceil(bp * budget / 10000)
        expect(RANK[statusFor(budget, first)]).toBeGreaterThanOrEqual(RANK[status]);
        expect(RANK[statusFor(budget, first - 1)]).toBeLessThan(RANK[status]);
      }
    }
  });
});

describe('calculateBudgetStatus: zero and negative', () => {
  it('zero budget: no spend is NORMAL, any spend needs approval (D3)', () => {
    expect(statusFor(0, 0)).toBe('NORMAL');
    expect(statusFor(0, 1)).toBe('APPROVAL_REQUIRED');
    expect(statusFor(0, 9_000_000)).toBe('APPROVAL_REQUIRED');
  });

  it('zero budget needs approval under any valid thresholds, because approval is at most 100%', () => {
    for (const t of [
      DEFAULTS,
      { warningBp: 1, approvalBp: 2 },
      { warningBp: 9999, approvalBp: 10000 },
    ])
      expect(statusFor(0, 1, t)).toBe('APPROVAL_REQUIRED');
  });

  it('negative actual (net reversals) is NORMAL', () => {
    expect(statusFor(1_000, -500)).toBe('NORMAL');
    expect(statusFor(0, -1)).toBe('NORMAL');
  });
});

describe('calculateBudgetStatus: agrees with exact rational maths', () => {
  it('exhaustively for every budget 1..400 fils and every actual from -10 to 125% of it', () => {
    let checked = 0;
    for (let budget = 1; budget <= 400; budget++) {
      for (let actual = -10; actual <= Math.ceil(budget * 1.25); actual++) {
        const want = exactStatus(BigInt(budget), BigInt(actual), DEFAULTS);
        if (statusFor(budget, actual) !== want)
          throw new Error(`budget ${budget} actual ${actual}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(80_000);
  });

  it('for 20,000 seeded random large values and random valid thresholds', () => {
    let seed = 0x9e3779b9;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x1_0000_0000;
    };
    for (let i = 0; i < 20_000; i++) {
      const budget = Math.floor(rand() * 1e15);
      const actual = Math.floor(rand() * budget * 1.3);
      const warningBp = 1 + Math.floor(rand() * 9998);
      const approvalBp = warningBp + 1 + Math.floor(rand() * (10000 - warningBp));
      const t = { warningBp, approvalBp };
      const want = exactStatus(BigInt(budget), BigInt(actual), t);
      if (statusFor(budget, actual, t) !== want)
        throw new Error(`${budget} ${actual} ${warningBp} ${approvalBp}`);
    }
  });

  it('uses no floating point: a value a float would get wrong is still exact', () => {
    // 0.8 * 3 = 2.4000000000000004 in floats; the exact boundary for budget 3 is actual 2.4 (never integer)
    expect(statusFor(3, 2)).toBe('NORMAL'); // 66.66%
    expect(statusFor(3, 3)).toBe('APPROVAL_REQUIRED');
    // budget 5: 80% is exactly 4
    expect(statusFor(5, 4)).toBe('WARNING');
    expect(utilisationBp(fils(5), fils(4))).toBe(8000);
  });
});

describe('calculateBudgetStatus: monotonic and configurable', () => {
  it('more spend never lowers the status', () => {
    for (const budget of [1, 17, 1_000, 123_456_789]) {
      let last = -1;
      for (let i = 0; i <= 300; i++) {
        const actual = Math.floor((budget * i) / 200);
        const rank = RANK[statusFor(budget, actual)];
        expect(rank).toBeGreaterThanOrEqual(last);
        last = rank;
      }
    }
  });

  it.each([
    [
      { warningBp: 7500, approvalBp: 9500 },
      [
        [7499, 'NORMAL'],
        [7500, 'WARNING'],
        [9499, 'WARNING'],
        [9500, 'APPROVAL_REQUIRED'],
      ],
    ],
    [
      { warningBp: 1, approvalBp: 2 },
      [
        [0, 'NORMAL'],
        [1, 'WARNING'],
        [2, 'APPROVAL_REQUIRED'],
      ],
    ],
    [
      { warningBp: 9999, approvalBp: 10000 },
      [
        [9998, 'NORMAL'],
        [9999, 'WARNING'],
        [10000, 'APPROVAL_REQUIRED'],
      ],
    ],
  ] as const)('custom thresholds %j', (t, cases) => {
    for (const [bp, status] of cases) expect(calculateBudgetStatus(bp, t)).toBe(status);
  });

  it.each([
    [{ warningBp: 9000, approvalBp: 9000 }],
    [{ warningBp: 9500, approvalBp: 9000 }],
    [{ warningBp: 0, approvalBp: 9000 }],
    [{ warningBp: 8000, approvalBp: 10001 }],
    [{ warningBp: 80.5, approvalBp: 10000 }],
    [{ warningBp: Number.NaN, approvalBp: 10000 }],
  ])('refuses invalid thresholds %j', (t) => {
    expect(() => calculateBudgetStatus(5000, t)).toThrow(RangeError);
    expect(() => checkThresholds(t)).toThrow(RangeError);
  });

  it('accepts a stored settings record (extra fields such as updatedAt are ignored)', () => {
    const stored = { ...DEFAULTS, updatedAt: new Date(), updatedBy: null };
    expect(calculateBudgetStatus(8000, stored)).toBe('WARNING');
    expect(checkThresholds(stored)).toEqual(DEFAULTS);
  });

  it.each([[0.5], [Number.NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 2]])(
    'refuses utilisation %s',
    (bp) => {
      expect(() => calculateBudgetStatus(bp, DEFAULTS)).toThrow(RangeError);
    },
  );
});

describe('projectedStatus', () => {
  const project = (budget: number, currentActual: number, newAmount: number, t = DEFAULTS) =>
    projectedStatus(
      { budget: fils(budget), currentActual: fils(currentActual), newAmount: fils(newAmount) },
      t,
    );

  it('shows the status an expense would cause before it is saved', () => {
    expect(project(1_000_000, 700_000, 99_999)).toMatchObject({
      status: 'NORMAL',
      metrics: { actual: 799_999, remaining: 200_001, utilisationBp: 7999 },
    });
    expect(project(1_000_000, 700_000, 100_000)).toMatchObject({
      status: 'WARNING',
      metrics: { utilisationBp: 8000 },
    });
    expect(project(1_000_000, 700_000, 299_999).status).toBe('WARNING');
    expect(project(1_000_000, 700_000, 300_000)).toMatchObject({
      status: 'APPROVAL_REQUIRED',
      metrics: { remaining: 0, utilisationBp: 10000 },
    });
    expect(project(1_000_000, 700_000, 300_100)).toMatchObject({
      status: 'APPROVAL_REQUIRED',
      metrics: { utilisationBp: 10001 },
    });
  });

  it('a reversal (negative amount) can bring the status back down', () => {
    expect(project(1_000_000, 1_050_000, -100_000)).toMatchObject({
      status: 'WARNING',
      metrics: { actual: 950_000 },
    });
    expect(project(1_000_000, 850_000, -850_000)).toMatchObject({
      status: 'NORMAL',
      metrics: { actual: 0 },
    });
  });

  it('zero budget: the first fils of spend needs approval', () => {
    expect(project(0, 0, 1).status).toBe('APPROVAL_REQUIRED');
    expect(project(0, 0, 0).status).toBe('NORMAL');
  });

  it('is exactly the status of the head after the spend, for many values', () => {
    const cases: [number, number, number][] = [
      [3, 1, 1],
      [1_234_567, 987_000, 653],
      [9_000_000_000, 7_199_999_999, 1],
      [10, 9, 1],
    ];
    for (const [b, a, n] of cases) {
      const p = project(b, a, n);
      expect(p.metrics).toEqual(budgetMetrics({ budget: fils(b), actual: fils(a + n) }));
      expect(p.status).toBe(statusFor(b, a + n));
    }
  });

  it('uses the thresholds it is given', () => {
    expect(project(1_000, 0, 750, { warningBp: 7500, approvalBp: 9000 }).status).toBe('WARNING');
    expect(project(1_000, 0, 750).status).toBe('NORMAL');
  });

  it('refuses a total beyond the safe money range', () => {
    expect(() => project(1, Number.MAX_SAFE_INTEGER, 1)).toThrow(MoneyError);
  });
});

describe('byUrgency', () => {
  it('puts approval first, then warning, then normal, keeping the order within each', () => {
    const rows = [
      { id: 'a', s: 'NORMAL' },
      { id: 'b', s: 'WARNING' },
      { id: 'c', s: 'APPROVAL_REQUIRED' },
      { id: 'd', s: 'NORMAL' },
      { id: 'e', s: 'WARNING' },
      { id: 'f', s: 'APPROVAL_REQUIRED' },
    ] as const;
    expect(byUrgency(rows, (r) => r.s).map((r) => r.id)).toEqual(['c', 'f', 'b', 'e', 'a', 'd']);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']); // not mutated
  });
});
