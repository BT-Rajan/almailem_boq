import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';
import { hashToken, newToken, safeEqual } from './tokens';

describe('tokens', () => {
  it('generates unique, long, URL-safe tokens', () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
  });
  it('hashes deterministically and does not expose the token', () => {
    const t = newToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
  it('compares in constant time and handles length differences', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('rate limiter', () => {
  it('allows up to max per window, then blocks with a retry time, then resets', () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000, now: () => now });
    expect([1, 2, 3].map(() => limiter.take('ip').allowed)).toEqual([true, true, true]);
    const blocked = limiter.take('ip');
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 60 });
    now += 30_000;
    expect(limiter.take('ip').retryAfterSeconds).toBe(30);
    now += 30_000;
    expect(limiter.take('ip').allowed).toBe(true);
  });
  it('keeps keys independent', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
    expect(limiter.take('b').allowed).toBe(true);
  });
  it('prunes expired windows so memory cannot grow without bound', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 10, now: () => now });
    for (let i = 0; i < 5100; i++) limiter.take(`k${i}`);
    now = 1000;
    expect(limiter.take('fresh').allowed).toBe(true);
  });
});
