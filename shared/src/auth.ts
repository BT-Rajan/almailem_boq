import { z } from 'zod';

/** Header the browser must send on every state-changing request (POST/PUT/PATCH/DELETE). */
export const CSRF_HEADER = 'x-csrf-token';

export const loginRequestSchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  // Capped so a huge string cannot be used to burn CPU in the password hasher.
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** Returned by login and by GET /api/auth/me. */
export const sessionInfoSchema = z.object({
  user: sessionUserSchema,
  permissions: z.array(z.string()),
  csrfToken: z.string(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
