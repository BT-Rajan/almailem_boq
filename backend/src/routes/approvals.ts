import type { FastifyInstance } from 'fastify';
import {
  approvalParamsSchema,
  approveRequestSchema,
  expenseParamsSchema,
  listApprovalsQuerySchema,
  okResponse,
  rejectRequestSchema,
} from '@boq/shared';
import { currentActor } from '../auth/guards';
import type { DbPool } from '../db/pool';
import { createApprovalService } from '../services/approvals';

/**
 * Approvals. Deciding needs approval.decide (administrators, D29) and spans every project, so those
 * routes are not project-scoped. A requester cancels their own request through the project.
 */
export function registerApprovalRoutes(app: FastifyInstance, deps: { pool: DbPool }): void {
  const service = createApprovalService(deps.pool);
  const { authenticate, authorize, authorizeProjectAccess } = app.guards;
  const decide = { onRequest: [authenticate, authorize('approval.decide')] };

  app.get('/api/approvals', decide, async (request) =>
    okResponse(await service.list(listApprovalsQuerySchema.parse(request.query))),
  );

  app.post('/api/approvals/:approvalId/approve', decide, async (request) => {
    const { approvalId } = approvalParamsSchema.parse(request.params);
    const { comment } = approveRequestSchema.parse(request.body ?? {});
    return okResponse(await service.approve(currentActor(request), approvalId, comment ?? null));
  });

  app.post('/api/approvals/:approvalId/reject', decide, async (request) => {
    const { approvalId } = approvalParamsSchema.parse(request.params);
    const { comment } = rejectRequestSchema.parse(request.body);
    return okResponse(await service.reject(currentActor(request), approvalId, comment));
  });

  app.post(
    '/api/projects/:projectId/expenses/:expenseId/cancel-approval',
    {
      onRequest: [authenticate, authorize('approval.request'), authorizeProjectAccess()],
    },
    async (request) => {
      const { projectId, expenseId } = expenseParamsSchema.parse(request.params);
      return okResponse(await service.cancel(currentActor(request), projectId, expenseId));
    },
  );
}
