import { z } from 'zod';

/** Every API response uses this envelope: { ok, data, error }. */

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export type ApiSuccess<T> = { ok: true; data: T; error: null };
export type ApiFailure = { ok: false; data: null; error: ApiError };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function okResponse<T>(data: T): ApiSuccess<T> {
  return { ok: true, data, error: null };
}

export function errorResponse(error: ApiError): ApiFailure {
  return { ok: false, data: null, error };
}

/** Runtime check used by tests and the frontend client. */
export function envelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data, error: z.null() }),
    z.object({ ok: z.literal(false), data: z.null(), error: apiErrorSchema }),
  ]);
}

export const healthSchema = z.object({ status: z.literal('ok') });
export type Health = z.infer<typeof healthSchema>;
