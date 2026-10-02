import type { LoginRequest, SessionInfo } from '@boq/shared';
import type { DbPool } from '../db/pool';
import { recordAudit } from '../audit/record-audit';
import { AppError } from '../errors/app-error';
import { permissionsRepository, sessionsRepository, usersRepository } from '../repositories';
import type { AuthConfig } from './config';
import { verifyPassword } from './passwords';
import { hashToken, newToken } from './tokens';
import type { AuthContext } from './types';

export type ClientMeta = { ip?: string | undefined; userAgent?: string | undefined };

/** One generic failure for every way a login can go wrong, so responses reveal nothing. */
const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);

export const toSessionInfo = (ctx: AuthContext): SessionInfo => ({
  user: ctx.user,
  permissions: [...ctx.permissions].sort(),
  csrfToken: ctx.csrfToken,
});

export function createAuthService(pool: DbPool, config: AuthConfig) {
  return {
    async login(
      creds: LoginRequest,
      meta: ClientMeta,
    ): Promise<{ token: string; info: SessionInfo }> {
      const users = usersRepository(pool);
      const user = await users.findByEmail(creds.email);
      if (user) await users.clearExpiredLock(user.id);

      // Exactly one password verification runs on every attempt, whatever the account state.
      const passwordOk = await verifyPassword(user?.passwordHash ?? null, creds.password);
      const eligible = user !== null && !user.disabled && !user.locked;

      if (!user || !eligible || !passwordOk) {
        // Only a real, enabled, unlocked account accumulates failures.
        if (user && eligible) {
          const result = await users.recordFailedLogin(
            user.id,
            config.maxAttempts,
            config.lockSeconds,
          );
          const actor = { userId: user.id };
          const entity = { type: 'user', id: user.id };
          await recordAudit(pool, 'auth.login_failed', actor, entity);
          if (result.locked) await recordAudit(pool, 'auth.account_locked', actor, entity);
        }
        throw invalidCredentials();
      }

      await users.recordSuccessfulLogin(user.id);
      const sessions = sessionsRepository(pool);
      await sessions.deleteExpired(config.idleSeconds); // opportunistic housekeeping

      const token = newToken();
      const csrfToken = newToken();
      await sessions.create({
        userId: user.id,
        tokenHash: hashToken(token),
        csrfToken,
        absoluteSeconds: config.absoluteSeconds,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
      const permissions = await permissionsRepository(pool).listCodesForUser(user.id);
      await recordAudit(pool, 'auth.login', { userId: user.id }, { type: 'user', id: user.id });

      return {
        token,
        info: { user: { id: user.id, email: user.email, name: user.name }, permissions, csrfToken },
      };
    },

    /** Turn a session cookie value into an AuthContext, or null if it is not (or no longer) valid. */
    async resolve(token: string): Promise<AuthContext | null> {
      const sessions = sessionsRepository(pool);
      const session = await sessions.findActive(hashToken(token), config.idleSeconds);
      if (!session) return null;
      await sessions.touch(session.id);
      const permissions = await permissionsRepository(pool).listCodesForUser(session.user.id);
      return {
        sessionId: session.id,
        csrfToken: session.csrfToken,
        user: session.user,
        permissions: new Set(permissions),
      };
    },

    async logout(ctx: AuthContext): Promise<void> {
      await sessionsRepository(pool).delete(ctx.sessionId);
      await recordAudit(
        pool,
        'auth.logout',
        { userId: ctx.user.id },
        { type: 'user', id: ctx.user.id },
      );
    },

    /** Drop a stale cookie's session (used when logging in again from an already-signed-in browser). */
    async revokeToken(token: string): Promise<void> {
      await sessionsRepository(pool).deleteByTokenHash(hashToken(token));
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
