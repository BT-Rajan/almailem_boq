import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('architecture: SQL lives only in repositories/ and db/', () => {
  const outside = files(SRC)
    .map((f) => relative(SRC, f))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => !f.startsWith('repositories/') && !f.startsWith('db/'));

  it('has application code to check', () => {
    expect(outside.length).toBeGreaterThan(0);
  });

  it.each(outside)('%s imports no database driver and contains no SQL', (file) => {
    const text = readFileSync(join(SRC, file), 'utf8');
    expect(text).not.toMatch(/from ['"]mysql2/);
    expect(text).not.toMatch(
      /\b(SELECT\s.+\sFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i,
    );
  });
});
