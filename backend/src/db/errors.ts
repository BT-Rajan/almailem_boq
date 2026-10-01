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

/** Run a write and translate constraint errors. */
export async function guarded<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw mapDbError(err, label);
  }
}
