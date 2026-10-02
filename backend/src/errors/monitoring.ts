/**
 * Error monitoring hook. Unexpected errors are always logged (structured, no request bodies); a
 * deployment can also register a reporter (Sentry, a webhook, ...) without touching other code.
 */
export type ErrorContext = {
  method?: string;
  url?: string;
  userId?: string | null;
  source: string;
};
export type ErrorReporter = (err: unknown, ctx: ErrorContext) => void | Promise<void>;

const reporters: ErrorReporter[] = [];

export function addErrorReporter(reporter: ErrorReporter): () => void {
  reporters.push(reporter);
  return () => {
    const i = reporters.indexOf(reporter);
    if (i >= 0) reporters.splice(i, 1);
  };
}

/** Never throws: a broken reporter must not take the request (or the process) down with it. */
export function reportError(err: unknown, ctx: ErrorContext): void {
  for (const r of reporters) {
    try {
      void Promise.resolve(r(err, ctx)).catch(() => undefined);
    } catch {
      // ignore
    }
  }
}
