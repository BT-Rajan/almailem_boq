import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { CSRF_HEADER, type PermissionCode } from '@boq/shared';
import type { DbPool } from '../db/pool';
import { AppError } from '../errors/app-error';
import { projectMembersRepository, projectsRepository } from '../repositories';
import type { AuthService } from './auth-service';
import type { AuthConfig } from './config';
import { safeEqual } from './tokens';
import type { AuthContext } from './types';

/** Markers let the route registry check, at startup, that every route is guarded. */
export const AUTHENTICATE_MARK = Symbol('boq.authenticate');
export const AUTHORIZE_MARK = Symbol('boq.authorize');

/** Holders count as a member of every project. */
export const ALL_PROJECTS_PERMISSION: PermissionCode = 'admin.projects.access';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mark = <T extends object>(fn: T, symbol: symbol, value: unknown = true): T =>
  Object.defineProperty(fn, symbol, { value });

/** The value a guard was marked with (a permission code, or "project:<param>"). */
export function markValue(handler: unknown, symbol: symbol): unknown {
  return typeof handler === 'function'
    ? (handler as unknown as Record<symbol, unknown>)[symbol]
    : undefined;
}

export function hasMark(handler: unknown, symbol: symbol): boolean {
  return (
    typeof handler === 'function' &&
    (handler as unknown as Record<symbol, unknown>)[symbol] !== undefined
  );
}

function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw AppError.unauthenticated(); // a guard used without authenticate first
  return request.auth;
}

/** The signed-in user as an audit actor. For use in routes behind authenticate. */
export const currentActor = (request: FastifyRequest): { userId: string } => ({
  userId: requireAuth(request).user.id,
});

/**
 * Which projects may this user list? Everything for holders of the all-projects permission,
 * otherwise only the projects they are a member of.
 */
export const projectListScope = (request: FastifyRequest): { memberUserId: string | null } => {
  const ctx = requireAuth(request);
  return { memberUserId: ctx.permissions.has(ALL_PROJECTS_PERMISSION) ? null : ctx.user.id };
};

export function createGuards(deps: { pool: DbPool; service: AuthService; config: AuthConfig }) {
  const { pool, service, config } = deps;

  /** Who is calling? Valid session, enabled user, and (for writes) a matching CSRF token. */
  const authenticate: onRequestAsyncHookHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const cookie = request.cookies[config.cookieName];
    const ctx = cookie ? await service.resolve(cookie) : null;
    if (!ctx) {
      if (cookie) void reply.clearCookie(config.cookieName, { path: '/' });
      throw AppError.unauthenticated();
    }
    if (UNSAFE_METHODS.has(request.method)) {
      const sent = request.headers[CSRF_HEADER];
      if (typeof sent !== 'string' || !safeEqual(sent, ctx.csrfToken)) {
        throw new AppError('CSRF_INVALID', 'Missing or invalid CSRF token', 403);
      }
    }
    request.auth = ctx;
  };

  /** May this user do this kind of thing? The only permission check in the codebase. */
  const authorize = (permission: PermissionCode): onRequestAsyncHookHandler =>
    mark(
      async (request: FastifyRequest) => {
        if (!requireAuth(request).permissions.has(permission)) throw AppError.forbidden();
      },
      AUTHORIZE_MARK,
      permission,
    );

  /**
   * May this user touch this project? Members, and holders of admin.projects.access, who count as a
   * member of every project (D17). A project that does not exist, is deleted, or has a malformed id
   * gets the same 403 as a non-member, so responses never reveal which projects exist.
   */
  const authorizeProjectAccess = (param = 'projectId'): onRequestAsyncHookHandler =>
    mark(
      async (request: FastifyRequest) => {
        const ctx = requireAuth(request);
        const id = (request.params as Record<string, unknown> | undefined)?.[param];
        const allowed =
          typeof id === 'string' &&
          UUID.test(id) &&
          (ctx.permissions.has(ALL_PROJECTS_PERMISSION)
            ? await projectsRepository(pool).isLive(id)
            : await projectMembersRepository(pool).hasAccess(id, ctx.user.id));
        if (!allowed) throw AppError.forbidden();
      },
      AUTHORIZE_MARK,
      `project:${param}`,
    );

  return {
    authenticate: mark(authenticate, AUTHENTICATE_MARK),
    authorize,
    authorizeProjectAccess,
  };
}

export type Guards = ReturnType<typeof createGuards>;
