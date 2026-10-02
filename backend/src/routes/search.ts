import type { FastifyInstance } from 'fastify';
import { globalSearchQuerySchema, okResponse } from '@boq/shared';
import { projectListScope } from '../auth/guards';
import type { DbPool } from '../db/pool';
import { searchRepository } from '../repositories';

/** Global search (the header box): grouped results, limited to the projects the caller may see. */
export function registerSearchRoutes(app: FastifyInstance, deps: { pool: DbPool }): void {
  const { authenticate, authorize } = app.guards;
  app.get(
    '/api/search',
    { onRequest: [authenticate, authorize('project.view')] },
    async (request, reply) => {
      const { q } = globalSearchQuerySchema.parse(request.query);
      void reply.header('cache-control', 'no-store');
      return okResponse(
        await searchRepository(deps.pool).search(q, projectListScope(request).memberUserId),
      );
    },
  );
}
