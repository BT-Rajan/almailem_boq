import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Secrets scan over every file git tracks. Test fixtures may hold throwaway passwords; nothing else
 * may hold a credential. Placeholders ("change-me") in .env.example are the documented exception.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !/\.(png|jpe?g|pdf|xlsx|ico|woff2?)$/i.test(f) && f !== 'pnpm-lock.yaml');
const isTest = (f: string) => /\.test\.tsx?$|(^|\/)testing\.ts$|^frontend\/e2e\//.test(f);

const PATTERNS: [string, RegExp][] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  [
    'generic API key',
    /\b(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9/+_-]{20,}['"]/i,
  ],
  ['password literal', /\bpassword\s*[:=]\s*['"](?!change-me)[^'"\s]{6,}['"]/i],
  [
    'database URL with a password',
    /\b(mysql|mariadb):\/\/[^:\s/]+:(?!change-me@|<password>@)[^@\s]+@/,
  ],
];

describe('secrets scan', () => {
  it('scans the whole repository', () => {
    expect(tracked.length).toBeGreaterThan(100);
  });

  it('no .env file is committed', () => {
    expect(
      tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example')),
    ).toEqual([]);
  });

  it.each(PATTERNS)('no %s outside test fixtures', (_label, pattern) => {
    const hits = tracked
      .filter((f) => !isTest(f))
      .filter((f) => pattern.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });
});
