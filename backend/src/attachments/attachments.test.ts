import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanFileName, sniffType } from './sniff';
import { createAttachmentStorage } from './storage';
import { JPG, PDF, PNG } from './testing';

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0]);

describe('sniffType', () => {
  it('recognises PDF, PNG and JPEG by their bytes', () => {
    expect(sniffType(PDF)).toBe('application/pdf');
    expect(sniffType(PNG)).toBe('image/png');
    expect(sniffType(JPG)).toBe('image/jpeg');
  });
  it('rejects anything else, including look-alikes and empty files', () => {
    expect(sniffType(new TextEncoder().encode('<html><script>'))).toBeNull();
    expect(sniffType(new TextEncoder().encode('%PDF'))).toBeNull(); // too short to be sure
    expect(sniffType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull(); // zip / docx
    expect(sniffType(new Uint8Array())).toBeNull();
  });
});

describe('cleanFileName', () => {
  it.each([
    ['invoice%2012.pdf', 'application/pdf', 'invoice 12.pdf'],
    ['..%2F..%2Fetc%2Fpasswd', 'application/pdf', '.._.._etc_passwd.pdf'],
    ['a"b<c>.png', 'image/png', 'abc.png'],
    ['%E0%A4%A', 'image/png', 'attachment.png'], // malformed encoding
    [undefined, 'image/jpeg', 'attachment.jpg'],
    ['فاتورة.pdf', 'application/pdf', 'فاتورة.pdf'],
  ] as const)('%s -> %s', (raw, type, expected) => {
    expect(cleanFileName(raw, type)).toBe(expected);
  });
});

describe('attachment storage', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it('stores under a random name, readable only by the owner, and removes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boq-att-'));
    dirs.push(dir);
    const s = createAttachmentStorage(dir);
    const a = await s.save(PDF);
    const b = await s.save(PDF);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    const file = join(dir, a.slice(0, 2), a);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const chunks: Buffer[] = [];
    for await (const c of s.open(a)) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-1.7\n%test');
    await s.remove(a);
    expect(await readdir(join(dir, a.slice(0, 2)))).not.toContain(a);
  });

  it('refuses keys that are not exactly 32 hex characters', () => {
    const s = createAttachmentStorage('/tmp');
    for (const key of ['../../etc/passwd', 'ABCDEF', `${'a'.repeat(32)}/x`, ''])
      expect(() => s.open(key)).toThrow('Invalid attachment key');
  });
});
