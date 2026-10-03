import { amountFilsSchema, kdToFils, type Fils } from '@boq/shared';

/**
 * Read a KWD amount typed by a person ("1,234.5") into fils, or null when it is not valid.
 * Kuwaiti dinars have 3 decimals (fils), so more than 3 decimals is refused, never rounded, and an
 * empty entry is no amount at all. The shared schema decides what is valid; the server checks again.
 */
export function parseKwdInput(text: string): Fils | null {
  if (!text.trim() || /\.\d{4,}/.test(text)) return null;
  try {
    const value = kdToFils(text);
    return amountFilsSchema.safeParse(value).success ? value : null;
  } catch {
    return null;
  }
}
