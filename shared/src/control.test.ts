import { describe, expect, it } from 'vitest';
import { percentToBp, thresholdsSchema } from './control';

describe('percentToBp', () => {
  it.each([
    ['80', 8000],
    ['80.5', 8050],
    ['80.05', 8005],
    ['99.99', 9999],
    ['100', 10000],
    [' 75 % ', 7500],
    ['0.01', 1],
  ])('%s -> %i', (text, bp) => {
    expect(percentToBp(text)).toBe(bp);
  });
  it.each([['80.001'], ['-5'], ['abc'], [''], ['1e2'], ['1000.5.5'], ['1000']])(
    'rejects %s',
    (text) => {
      expect(percentToBp(text)).toBeNull();
    },
  );
});

describe('thresholdsSchema', () => {
  it('accepts warning below approval, approval at most 100%', () => {
    expect(thresholdsSchema.safeParse({ warningBp: 8000, approvalBp: 10000 }).success).toBe(true);
    expect(thresholdsSchema.safeParse({ warningBp: 1, approvalBp: 2 }).success).toBe(true);
  });
  it.each([
    [{ warningBp: 9000, approvalBp: 9000 }],
    [{ warningBp: 9500, approvalBp: 9000 }],
    [{ warningBp: 0, approvalBp: 9000 }],
    [{ warningBp: 8000, approvalBp: 10001 }],
    [{ warningBp: 80.5, approvalBp: 10000 }],
    [{ warningBp: 8000 }],
    [{ warningBp: 8000, approvalBp: 10000, extra: 1 }],
  ])('rejects %j', (t) => {
    expect(thresholdsSchema.safeParse(t).success).toBe(false);
  });
});
