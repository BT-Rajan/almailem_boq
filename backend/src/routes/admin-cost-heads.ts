import type { FastifyInstance } from 'fastify';
import {
  costHeadIdParamsSchema,
  createCostHeadRequestSchema,
  okResponse,
  reorderCostHeadsRequestSchema,
  updateCostHeadRequestSchema,
} from '@boq/shared';
import { currentActor } from '../auth/guards';
import type { DbPool } from '../db/pool';
import { createCostHeadService } from '../services/cost-heads';

/** Administration > Cost Heads. Thin: validate > guard > service. */
export function registerAdminCostHeadRoutes(app: FastifyInstance, deps: { pool: DbPool }): void {
  const service = createCostHeadService(deps.pool);
  const { authenticate, authorize } = app.guards;
  const manage = { onRequest: [authenticate, authorize('admin.costheads.manage')] };

  app.get('/api/admin/cost-heads', manage, async () => okResponse(await service.list()));

  app.post('/api/admin/cost-heads', manage, async (request, reply) => {
    const input = createCostHeadRequestSchema.parse(request.body);
    const head = await service.create(currentActor(request), input);
    void reply.code(201);
    return okResponse(head);
  });

  app.patch('/api/admin/cost-heads/:costHeadId', manage, async (request) => {
    const { costHeadId } = costHeadIdParamsSchema.parse(request.params);
    const patch = updateCostHeadRequestSchema.parse(request.body);
    return okResponse(await service.update(currentActor(request), costHeadId, patch));
  });

  app.put('/api/admin/cost-heads/order', manage, async (request) => {
    const { ids } = reorderCostHeadsRequestSchema.parse(request.body);
    return okResponse(await service.reorder(currentActor(request), ids));
  });
}
