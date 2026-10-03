import type { FastifyInstance } from 'fastify';
import {
  approvalParamsSchema,
  approveRequestSchema,
  expenseParamsSchema,
  listApprovalsQuerySchema,
  listBudgetApprovalsQuerySchema,
  projectIdParamsSchema,
  submitBudgetRequestSchema,
  okResponse,
  rejectRequestSchema,
} from '@boq/shared';
import { currentActor } from '../auth/guards';
import type { DbPool } from '../db/pool';
import { createApprovalService } from '../services/approvals';
import { createBudgetApprovalService } from '../services/budget-approvals';

/**
 * Approvals. Deciding needs approval.decide (administrators, D29) and spans every project, so those
 * routes are not project-scoped. A requester cancels their own request through the project.
 */
export function registerApprovalRoutes(app: FastifyInstance, deps: { pool: DbPool }): void {
  const service = createApprovalService(deps.pool);
  const budgets = createBudgetApprovalService(deps.pool);
  const { authenticate, authorize, authorizeProjectAccess } = app.guards;
  const decide = { onRequest: [authenticate, authorize('approval.decide')] };

  app.get('/api/approvals', decide, async (request) =>
    okResponse(await service.list(listApprovalsQuerySchema.parse(request.query))),
  );

  app.get('/api/approvals/cost-structures', decide, async (request) =>
    okResponse(await budgets.list(listBudgetApprovalsQuerySchema.parse(request.query))),
  );

  app.post(
    '/api/projects/:projectId/cost-structure/proposals',
    { onRequest: [authenticate, authorize('estimate.edit'), authorizeProjectAccess()] },
    async (request, reply) => {
      const { projectId } = projectIdParamsSchema.parse(request.params);
      const input = submitBudgetRequestSchema.parse(request.body);
      const proposal = await budgets.submit(currentActor(request), projectId, input);
      void reply.code(201);
      return okResponse(proposal);
    },
  );

  app.get(
    '/api/projects/:projectId/cost-structure',
    { onRequest: [authenticate, authorize('project.view'), authorizeProjectAccess()] },
    async (request) => {
      const { projectId } = projectIdParamsSchema.parse(request.params);
      return okResponse(await budgets.costStructure(projectId));
    },
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
