export type RateLimiter = {
  /** Count one attempt for `key` and say whether it is allowed. */
  take(key: string): { allowed: boolean; retryAfterSeconds: number };
};

/**
 * Fixed-window limiter, in memory. Per server process: with several instances each keeps its own
 * count. Account lockout (in the database) is what protects a single account across instances.
 */
export function createRateLimiter(options: {
  max: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    take(key) {
      const t = now();
      if (windows.size > 5000) {
        for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
      }
      let w = windows.get(key);
      if (!w || w.resetAt <= t) {
        w = { count: 0, resetAt: t + options.windowMs };
        windows.set(key, w);
      }
      w.count += 1;
      return {
        allowed: w.count <= options.max,
        retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - t) / 1000)),
      };
    },
  };
}
