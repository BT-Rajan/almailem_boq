import type { FastifyInstance } from 'fastify';
import { okResponse, thresholdsSchema } from '@boq/shared';
import { currentActor } from '../auth/guards';
import type { DbPool } from '../db/pool';
import { createThresholdService } from '../services/thresholds';

/** Administration > Approval Rules: the warning and approval levels. */
export function registerAdminThresholdRoutes(app: FastifyInstance, deps: { pool: DbPool }): void {
  const service = createThresholdService(deps.pool);
  const { authenticate, authorize } = app.guards;
  const manage = { onRequest: [authenticate, authorize('admin.approvalrules.manage')] };

  app.get('/api/admin/approval-rules', manage, async () => okResponse(await service.get()));

  app.put('/api/admin/approval-rules', manage, async (request) => {
    const input = thresholdsSchema.parse(request.body);
    return okResponse(await service.update(currentActor(request), input));
  });
}
