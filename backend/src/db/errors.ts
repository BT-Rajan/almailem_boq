import { AppError } from '../errors/app-error';

const DUP_ENTRY = 'ER_DUP_ENTRY';
const NO_REFERENCED_ROW = 'ER_NO_REFERENCED_ROW_2';
const ROW_IS_REFERENCED = 'ER_ROW_IS_REFERENCED_2';

function codeOf(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

/**
 * Turn driver errors for known constraint failures into AppErrors.
 * Messages are generic on purpose: they never echo SQL, column values or table internals.
 */
export function mapDbError(err: unknown, label: string): unknown {
  switch (codeOf(err)) {
    case DUP_ENTRY:
      return AppError.conflict(`${label} already exists`);
    case NO_REFERENCED_ROW:
      return AppError.validation(`${label} refers to a record that does not exist`);
    case ROW_IS_REFERENCED:
      return AppError.conflict(`${label} is in use and cannot be removed`);
    default:
      return err;
  }
}

export const isDuplicateKey = (err: unknown): boolean => codeOf(err) === DUP_ENTRY;

/**
 * Insert a row that may already exist. True when inserted, false when it was already there.
 * (ON DUPLICATE KEY cannot tell the two apart: the driver reports found rows, not changed rows.)
 * A duplicate-key error rolls back only its own statement, so this is safe inside a transaction.
 */
export async function insertIfMissing(
  label: string,
  run: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (err) {
    if (isDuplicateKey(err)) return false;
    throw mapDbError(err, label);
  }
}

/** Run a write and translate constraint errors. */
export async function guarded<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw mapDbError(err, label);
  }
}
