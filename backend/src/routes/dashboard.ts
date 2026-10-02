import type { FastifyInstance } from 'fastify';
import { okResponse } from '@boq/shared';
import { projectListScope } from '../auth/guards';
import type { DbPool } from '../db/pool';
import { createDashboardService } from '../services/dashboard';

/** Home dashboard: only the projects the caller may see (all of them for administrators). */
export function registerDashboardRoutes(app: FastifyInstance, deps: { pool: DbPool }): void {
  const service = createDashboardService(deps.pool);
  const { authenticate, authorize } = app.guards;

  app.get(
    '/api/dashboard',
    { onRequest: [authenticate, authorize('project.view')] },
    async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      return okResponse(await service.get(projectListScope(request)));
    },
  );
}
