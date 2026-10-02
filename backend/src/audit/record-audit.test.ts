import { describe, expect, it } from 'vitest';
import { redactSensitive } from './record-audit';

describe('redactSensitive', () => {
  it('hides secrets at any depth and keeps everything else', () => {
    const out = redactSensitive({
      name: 'Ali',
      passwordHash: 'x',
      password: 'y',
      nested: {
        csrf_token: 't',
        api_secret: 's',
        keep: 1,
        list: [{ authorization: 'Bearer z', ok: true }],
      },
    });
    expect(out).toEqual({
      name: 'Ali',
      passwordHash: '[redacted]',
      password: '[redacted]',
      nested: {
        csrf_token: '[redacted]',
        api_secret: '[redacted]',
        keep: 1,
        list: [{ authorization: '[redacted]', ok: true }],
      },
    });
  });
  it('passes through primitives, null, and serialises dates', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(5)).toBe(5);
    expect(redactSensitive(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
  });
  it('stops at a depth limit instead of recursing forever', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(JSON.stringify(redactSensitive(a))).toContain('[truncated]');
  });
});
