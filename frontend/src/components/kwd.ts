import { amountFilsSchema, kdToFils, type Fils } from '@boq/shared';

/**
 * Read a KWD amount typed by a person ("1,234.5") into fils, or null when it is not a valid budget.
 * Empty means zero. The shared schema decides what is valid; the server checks again.
 */
export function parseKwdInput(text: string): Fils | null {
  if (!text.trim()) return kdToFils(0);
  try {
    const value = kdToFils(text);
    return amountFilsSchema.safeParse(value).success ? value : null;
  } catch {
    return null;
  }
}
