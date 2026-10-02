import type { SessionUser } from '@boq/shared';
import type { Guards } from './guards';

/** What authenticate() attaches to a request once the session checks out. */
export type AuthContext = {
  sessionId: string;
  csrfToken: string;
  user: SessionUser;
  permissions: ReadonlySet<string>;
};

export type RouteInfo = {
  method: string;
  url: string;
  public: boolean;
  /** Permission codes required by authorize() guards on the route. */
  permissions: string[];
  /** Route parameter checked by authorizeProjectAccess(), if any. */
  projectParam: string | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
  interface FastifyInstance {
    guards: Guards;
    /** Every route registered, with whether it is public. Used by tests to pin the public surface. */
    routeRegistry: RouteInfo[];
  }
  interface FastifyContextConfig {
    /** No authentication required. Must be set deliberately. */
    public?: boolean;
    /** Signed-in users only, no specific permission (for /me, /logout). */
    authenticatedOnly?: boolean;
  }
}
