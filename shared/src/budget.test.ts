import { describe, expect, it } from 'vitest';
import { formatUtilisation, setEstimatesRequestSchema } from './budget';

describe('formatUtilisation', () => {
  it.each([
    [0, '0.00%'],
    [1, '0.01%'],
    [7999, '79.99%'],
    [8000, '80.00%'],
    [10000, '100.00%'],
    [123456, '1234.56%'],
    [-250, '-2.50%'],
  ])('%i bp -> %s', (bp, text) => {
    expect(formatUtilisation(bp)).toBe(text);
  });
});

describe('setEstimatesRequestSchema', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('accepts integer fils, including zero and the largest safe integer', () => {
    for (const amountFils of [0, 1, Number.MAX_SAFE_INTEGER])
      expect(
        setEstimatesRequestSchema.safeParse({ estimates: [{ costHeadId: id, amountFils }] })
          .success,
      ).toBe(true);
  });
  it.each([[-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], ['100']])('rejects %s', (amountFils) => {
    expect(
      setEstimatesRequestSchema.safeParse({ estimates: [{ costHeadId: id, amountFils }] }).success,
    ).toBe(false);
  });
  it('rejects the same head twice and an empty list', () => {
    const row = { costHeadId: id, amountFils: 1 };
    expect(setEstimatesRequestSchema.safeParse({ estimates: [row, row] }).success).toBe(false);
    expect(setEstimatesRequestSchema.safeParse({ estimates: [] }).success).toBe(false);
  });
});
