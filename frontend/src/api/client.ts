import { CSRF_HEADER, type ApiResponse } from '@boq/shared';

/** The one way the UI talks to the API. Unwraps the {ok, data, error} envelope. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** "Invalid input" alone is no help: append the field messages the server sends with it. */
function messageOf(error: { message: string; details?: unknown }): string {
  if (!Array.isArray(error.details)) return error.message;
  const fields = error.details
    .map((d: { message?: unknown }) => (typeof d?.message === 'string' ? d.message : null))
    .filter((m): m is string => m !== null);
  return fields.length ? `${error.message}: ${[...new Set(fields)].join('; ')}` : error.message;
}

let csrfToken: string | null = null;

/** Set from the session info returned by login and /me; sent on every write. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken;

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  let envelope: ApiResponse<T> | null = null;
  try {
    envelope = (await res.json()) as ApiResponse<T>;
  } catch {
    // not JSON: fall through to a generic error
  }
  if (!envelope) throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response from server');
  if (!envelope.ok) throw new ApiError(res.status, envelope.error.code, messageOf(envelope.error));
  return envelope.data;
}

/** Build "?a=1&b=2", skipping empty values. */
export function queryString(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}
