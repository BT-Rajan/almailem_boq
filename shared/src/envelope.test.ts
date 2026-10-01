import { describe, expect, it } from 'vitest';
import { envelopeSchema, errorResponse, healthSchema, okResponse } from './envelope';

describe('envelope', () => {
  const schema = envelopeSchema(healthSchema);
  it('wraps success', () => {
    const res = okResponse({ status: 'ok' as const });
    expect(res).toEqual({ ok: true, data: { status: 'ok' }, error: null });
    expect(schema.safeParse(res).success).toBe(true);
  });
  it('wraps failure', () => {
    const res = errorResponse({ code: 'NOT_FOUND', message: 'nope' });
    expect(res).toEqual({ ok: false, data: null, error: { code: 'NOT_FOUND', message: 'nope' } });
    expect(schema.safeParse(res).success).toBe(true);
  });
  it('rejects a malformed envelope', () => {
    expect(schema.safeParse({ ok: true, data: { status: 'bad' }, error: null }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ok: false, data: { x: 1 }, error: null }).success).toBe(false);
  });
});
