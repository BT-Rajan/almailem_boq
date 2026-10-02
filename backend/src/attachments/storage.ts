import { randomBytes } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Attachment files on disk, under random names, in a directory no web server serves.
 * The database holds the key; only an authorised route reads a file back.
 */
const KEY = /^[0-9a-f]{32}$/;

export type AttachmentStorage = ReturnType<typeof createAttachmentStorage>;

export function createAttachmentStorage(dir: string) {
  const root = resolve(dir);
  /** Keys are checked before they touch a path, so a stored value can never point elsewhere. */
  const pathOf = (key: string) => {
    if (!KEY.test(key)) throw new Error('Invalid attachment key');
    return join(root, key.slice(0, 2), key);
  };

  return {
    async save(data: Uint8Array): Promise<string> {
      const key = randomBytes(16).toString('hex');
      const path = pathOf(key);
      await mkdir(join(root, key.slice(0, 2)), { recursive: true, mode: 0o700 });
      await writeFile(path, data, { flag: 'wx', mode: 0o600 }); // never overwrite
      return key;
    },
    open(key: string): ReadStream {
      return createReadStream(pathOf(key));
    },
    async remove(key: string): Promise<void> {
      await rm(pathOf(key), { force: true });
    },
  };
}
