import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (the library default) with the OWASP minimum cost: 19 MiB memory, 2 passes, 1 lane.
 * The encoded hash carries its own parameters, so the cost can be raised later without a migration.
 */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

let dummyHash: Promise<string> | undefined;

/**
 * Verify a password. Pass null when the user does not exist: a real verification still runs
 * against a throwaway hash, so response time does not reveal whether an email is registered.
 * Always returns false for null.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  dummyHash ??= hash('not-a-real-password', OPTIONS);
  try {
    const ok = await verify(storedHash ?? (await dummyHash), password);
    return storedHash !== null && ok;
  } catch {
    return false; // malformed stored hash must never throw into the login path
  }
}
