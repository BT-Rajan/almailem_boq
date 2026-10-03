import type { FastifyInstance } from 'fastify';
import {
  ATTACHMENT_NAME_HEADER,
  ATTACHMENT_TYPES,
  costHeadParamsSchema,
  createExpenseRequestSchema,
  expenseParamsSchema,
  listExpensesQuerySchema,
  okResponse,
  projectIdParamsSchema,
  projectionQuerySchema,
  reverseExpenseRequestSchema,
  updateExpenseRequestSchema,
} from '@boq/shared';
import type { AttachmentStorage } from '../attachments/storage';
import { currentActor } from '../auth/guards';
import type { RateLimiter } from '../auth/rate-limit';
import { AppError } from '../errors/app-error';
import type { DbPool } from '../db/pool';
import { createExpenseService } from '../services/expenses';

/** Expenses, reversals, attachments and the cost-head detail. Thin: validate > guard > service. */
export function registerExpenseRoutes(
  app: FastifyInstance,
  deps: {
    pool: DbPool;
    storage: AttachmentStorage;
    attachmentMaxBytes: number;
    uploadLimiter: RateLimiter;
  },
): void {
  const service = createExpenseService(deps.pool, deps.storage);
  const { authenticate, authorize, authorizeProjectAccess } = app.guards;
  const onProject = (permission: Parameters<typeof authorize>[0]) => ({
    onRequest: [authenticate, authorize(permission), authorizeProjectAccess()],
  });

  app.get('/api/projects/:projectId/expenses', onProject('expense.view'), async (request) => {
    const { projectId } = projectIdParamsSchema.parse(request.params);
    return okResponse(await service.list(projectId, listExpensesQuerySchema.parse(request.query)));
  });

  app.post(
    '/api/projects/:projectId/expenses',
    onProject('expense.create'),
    async (request, reply) => {
      const { projectId } = projectIdParamsSchema.parse(request.params);
      const input = createExpenseRequestSchema.parse(request.body);
      const expense = await service.create(currentActor(request), projectId, input);
      void reply.code(201);
      return okResponse(expense);
    },
  );

  app.patch(
    '/api/projects/:projectId/expenses/:expenseId',
    onProject('expense.edit'),
    async (request) => {
      const { projectId, expenseId } = expenseParamsSchema.parse(request.params);
      const patch = updateExpenseRequestSchema.parse(request.body);
      return okResponse(await service.update(currentActor(request), projectId, expenseId, patch));
    },
  );

  // Administrators only: everyone else corrects with a reversal.
  app.delete(
    '/api/projects/:projectId/expenses/:expenseId',
    onProject('admin.expenses.delete'),
    async (request) => {
      const { projectId, expenseId } = expenseParamsSchema.parse(request.params);
      await service.remove(currentActor(request), projectId, expenseId);
      return okResponse({ deleted: true as const });
    },
  );

  app.post(
    '/api/projects/:projectId/expenses/:expenseId/reverse',
    onProject('expense.reverse'),
    async (request, reply) => {
      const { projectId, expenseId } = expenseParamsSchema.parse(request.params);
      const { reason } = reverseExpenseRequestSchema.parse(request.body);
      const reversal = await service.reverse(currentActor(request), projectId, expenseId, reason);
      void reply.code(201);
      return okResponse(reversal);
    },
  );

  app.get(
    '/api/projects/:projectId/expenses/:expenseId/attachment',
    onProject('expense.view'),
    async (request, reply) => {
      const { projectId, expenseId } = expenseParamsSchema.parse(request.params);
      const file = await service.openAttachment(projectId, expenseId);
      // Always a download, never rendered in our origin; the stored type is the sniffed one.
      return reply
        .header('content-type', file.type)
        .header('content-length', String(file.size))
        .header(
          'content-disposition',
          `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        )
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .send(file.stream);
    },
  );

  app.get(
    '/api/projects/:projectId/cost-heads/:costHeadId/projection',
    onProject('expense.create'),
    async (request) => {
      const { projectId, costHeadId } = costHeadParamsSchema.parse(request.params);
      const { amountFils } = projectionQuerySchema.parse(request.query);
      return okResponse(await service.projection(projectId, costHeadId, amountFils));
    },
  );

  app.get(
    '/api/projects/:projectId/cost-heads/:costHeadId',
    onProject('expense.view'),
    async (request) => {
      const { projectId, costHeadId } = costHeadParamsSchema.parse(request.params);
      const query = listExpensesQuerySchema.parse(request.query);
      return okResponse(await service.costHeadDetail(projectId, costHeadId, query));
    },
  );

  // The upload takes the file itself as the body. Only this route accepts these content types,
  // and only up to the configured size.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      [...ATTACHMENT_TYPES],
      { parseAs: 'buffer', bodyLimit: deps.attachmentMaxBytes },
      (_request, body, done) => done(null, body),
    );
    scope.put(
      '/api/projects/:projectId/expenses/:expenseId/attachment',
      { ...onProject('expense.edit'), bodyLimit: deps.attachmentMaxBytes },
      async (request, reply) => {
        const { projectId, expenseId } = expenseParamsSchema.parse(request.params);
        const actor = currentActor(request);
        const verdict = deps.uploadLimiter.take(`upload:${actor.userId}`);
        if (!verdict.allowed) {
          void reply.header('retry-after', String(verdict.retryAfterSeconds));
          throw AppError.rateLimited('Too many uploads. Try again later.');
        }
        const data = request.body;
        const rawName = request.headers[ATTACHMENT_NAME_HEADER];
        return okResponse(
          await service.attach(actor, projectId, expenseId, {
            data: Buffer.isBuffer(data) ? data : Buffer.alloc(0),
            declaredType:
              String(request.headers['content-type'] ?? '')
                .split(';')[0]
                ?.trim() ?? '',
            rawName: typeof rawName === 'string' ? rawName : undefined,
          }),
        );
      },
    );
  });
}
