import { describe, expect, it } from 'vitest';
import { addFils, fils, formatFils, kdToFils, MoneyError, subFils, sumFils } from './money';

describe('fils()', () => {
  it('accepts safe integers and normalises -0', () => {
    expect(fils(1234)).toBe(1234);
    expect(Object.is(fils(-0), 0)).toBe(true);
  });
  it('rejects floats, NaN, Infinity and unsafe integers', () => {
    expect(() => fils(1.5)).toThrow(MoneyError);
    expect(() => fils(Number.NaN)).toThrow(MoneyError);
    expect(() => fils(Infinity)).toThrow(MoneyError);
    expect(() => fils(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts and sums exactly', () => {
    expect(addFils(fils(100), fils(23))).toBe(123);
    expect(subFils(fils(100), fils(123))).toBe(-23);
    expect(sumFils([fils(1), fils(2), fils(3)])).toBe(6);
    expect(sumFils([])).toBe(0);
  });
  it('throws on overflow beyond safe integers', () => {
    expect(() => addFils(fils(Number.MAX_SAFE_INTEGER), fils(1))).toThrow(MoneyError);
  });
});

describe('kdToFils()', () => {
  it('parses strings exactly', () => {
    expect(kdToFils('0')).toBe(0);
    expect(kdToFils('1')).toBe(1000);
    expect(kdToFils('1.5')).toBe(1500);
    expect(kdToFils('1.234')).toBe(1234);
    expect(kdToFils('0.001')).toBe(1);
    expect(kdToFils('264,153.500')).toBe(264153500);
    expect(kdToFils(' -12.340 ')).toBe(-12340);
  });
  it('rounds half away from zero beyond 3 decimals', () => {
    expect(kdToFils('1.0005')).toBe(1001);
    expect(kdToFils('1.0004')).toBe(1000);
    expect(kdToFils('-1.0005')).toBe(-1001);
    expect(kdToFils('0.0005')).toBe(1);
    expect(kdToFils('0.00049')).toBe(0);
  });
  it('is not disturbed by float noise', () => {
    expect(kdToFils(0.1 + 0.2)).toBe(300); // 0.30000000000000004
    expect(kdToFils(1.005)).toBe(1005);
    expect(kdToFils(263953.5)).toBe(263953500);
    expect(kdToFils(1e-7)).toBe(0);
  });
  it('rejects garbage', () => {
    for (const bad of ['', 'abc', '1.2.3', '--1', '1e3', Number.NaN, Infinity]) {
      expect(() => kdToFils(bad)).toThrow(MoneyError);
    }
  });
});

describe('formatFils()', () => {
  it('uses Kuwait style grouping with 3 decimals', () => {
    expect(formatFils(fils(0))).toBe('0.000');
    expect(formatFils(fils(1))).toBe('0.001');
    expect(formatFils(fils(999))).toBe('0.999');
    expect(formatFils(fils(1000))).toBe('1.000');
    expect(formatFils(fils(1234567))).toBe('1,234.567');
    expect(formatFils(fils(264153500))).toBe('264,153.500');
    expect(formatFils(fils(123456789012))).toBe('123,456,789.012');
  });
  it('formats negatives', () => {
    expect(formatFils(fils(-1))).toBe('-0.001');
    expect(formatFils(fils(-1234567))).toBe('-1,234.567');
  });
  it('round-trips with kdToFils', () => {
    for (const v of [0, 1, 999, 1000, 1234567, -1234567, 208057000]) {
      expect(kdToFils(formatFils(fils(v)))).toBe(v);
    }
  });
});
