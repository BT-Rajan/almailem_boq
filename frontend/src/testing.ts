import { vi } from 'vitest';

/** Test support: answer fetch() from a table of "METHOD /path" handlers, recording every call. */
export type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
type Handler = (call: Call) => {
  status?: number;
  data?: unknown;
  error?: { code: string; message: string };
};

export function mockApi(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? 'GET',
        url,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const path = url.split('?')[0];
      const handler = handlers[`${call.method} ${path}`];
      const r = handler
        ? handler(call)
        : { status: 404, error: { code: 'NOT_FOUND', message: 'nf' } };
      const ok = !r.error;
      return new Response(
        JSON.stringify(
          ok ? { ok, data: r.data ?? null, error: null } : { ok, data: null, error: r.error },
        ),
        { status: r.status ?? (ok ? 200 : 400), headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  return calls;
}
