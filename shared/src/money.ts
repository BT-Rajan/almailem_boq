/**
 * Money helpers. KWD has 3 decimals, so all amounts are integer fils (1 KWD = 1000 fils).
 * Floats never hold money. Parse once at the edge, format once at the edge.
 * A Fils value is a safe integer; anything else is rejected.
 */

export type Fils = number & { readonly __brand: 'Fils' };

const FILS_PER_KWD = 1000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Validate and brand an integer number of fils. */
export function fils(value: number): Fils {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Fils must be a safe integer, got ${String(value)}`);
  }
  return (value === 0 ? 0 : value) as Fils; // normalise -0
}

export function addFils(a: Fils, b: Fils): Fils {
  return fils(a + b);
}

export function subFils(a: Fils, b: Fils): Fils {
  return fils(a - b);
}

export function sumFils(values: readonly Fils[]): Fils {
  return values.reduce<Fils>((total, v) => addFils(total, v), fils(0));
}

const DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;

/**
 * Convert a KWD amount to fils.
 * Strings are parsed exactly. Numbers are read via their shortest decimal text, so
 * 0.1 + 0.2 style float noise does not move the result. More than 3 decimals are
 * rounded half away from zero (1.0005 KWD -> 1001 fils, -1.0005 -> -1001).
 * Accepts thousands separators (",") in strings, e.g. "1,234.567".
 */
export function kdToFils(input: string | number): Fils {
  let text: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyError('Amount must be a finite number');
    text = /e/i.test(String(input)) ? input.toFixed(12) : String(input);
  } else {
    text = input.trim().replace(/,/g, '');
  }

  const match = DECIMAL.exec(text);
  if (!match) throw new MoneyError(`Invalid KWD amount: "${String(input)}"`);

  const sign = match[1] === '-' ? -1 : 1;
  const whole = match[2] ?? '0';
  const frac = match[3] ?? '';

  const padded = (frac + '000').slice(0, 3);
  const roundUp = frac.length > 3 && Number(frac[3]) >= 5;

  const base = Number(whole) * FILS_PER_KWD + Number(padded);
  return fils(sign * (base + (roundUp ? 1 : 0)));
}

/**
 * Format fils as "1,234.567" (Kuwait style: thousands separator, always 3 decimals).
 * Integer maths only. This is the single money formatter; use it at the UI edge.
 */
export function formatFils(value: Fils): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / FILS_PER_KWD);
  const rest = abs % FILS_PER_KWD;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `${grouped}.${String(rest).padStart(3, '0')}`;
  return negative ? `-${text}` : text;
}
