import type { FastifyInstance } from 'fastify';
import { okResponse, projectIdParamsSchema, setEstimatesRequestSchema } from '@boq/shared';
import { currentActor } from '../auth/guards';
import type { DbPool } from '../db/pool';
import { createEstimateService } from '../services/estimates';

/** Project BoQ (budget per cost head) and estimate edits. Metrics come from the service only. */
export function registerEstimateRoutes(app: FastifyInstance, deps: { pool: DbPool }): void {
  const service = createEstimateService(deps.pool);
  const { authenticate, authorize, authorizeProjectAccess } = app.guards;

  app.get(
    '/api/projects/:projectId/boq',
    { onRequest: [authenticate, authorize('project.view'), authorizeProjectAccess()] },
    async (request) => {
      const { projectId } = projectIdParamsSchema.parse(request.params);
      return okResponse(await service.getBoq(projectId));
    },
  );

  app.put(
    '/api/projects/:projectId/estimates',
    { onRequest: [authenticate, authorize('estimate.edit'), authorizeProjectAccess()] },
    async (request) => {
      const { projectId } = projectIdParamsSchema.parse(request.params);
      const body = setEstimatesRequestSchema.parse(request.body);
      return okResponse(await service.setEstimates(currentActor(request), projectId, body));
    },
  );
}
