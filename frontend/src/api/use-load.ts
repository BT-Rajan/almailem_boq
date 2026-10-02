import { useCallback, useEffect, useState } from 'react';

export type Loaded<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/** Load data for a screen and reload on demand. `load` must be stable (wrap it in useCallback). */
export function useLoad<T>(load: () => Promise<T>): Loaded<T> {
  const [version, setVersion] = useState(0);
  // Each result remembers which request produced it, so "loading" is derived, never set by hand.
  const [result, setResult] = useState<{
    load: () => Promise<T>;
    version: number;
    data: T | undefined;
    error: string | null;
  }>();

  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setResult({ load, version, data, error: null }),
      (e: unknown) =>
        live &&
        setResult((prev) => ({
          load,
          version,
          data: prev?.data, // keep showing the last good data alongside the error
          error: e instanceof Error ? e.message : 'Something went wrong',
        })),
    );
    return () => {
      live = false;
    };
  }, [load, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return {
    data: result?.data,
    error: result?.error ?? null,
    loading: result?.load !== load || result.version !== version,
    reload,
  };
}

/** Run an action, returning its error message (or null). For buttons and forms. */
export async function attempt(action: () => Promise<unknown>): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Something went wrong';
  }
}
