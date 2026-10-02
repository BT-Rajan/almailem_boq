import type { FastifyInstance } from 'fastify';
import {
  createUserRequestSchema,
  listUsersQuerySchema,
  okResponse,
  setUserDisabledRequestSchema,
  userIdParamsSchema,
  userProjectParamsSchema,
  userRoleParamsSchema,
} from '@boq/shared';
import { currentActor } from '../auth/guards';
import type { DbPool } from '../db/pool';
import { createUserAdminService } from '../services/user-admin';

/** Administration > Users and Roles. Thin: validate > guard > service. */
export function registerAdminUserRoutes(app: FastifyInstance, deps: { pool: DbPool }): void {
  const service = createUserAdminService(deps.pool);
  const { authenticate, authorize } = app.guards;
  const manage = { onRequest: [authenticate, authorize('admin.users.manage')] };

  app.get('/api/admin/users', manage, async (request) =>
    okResponse(await service.listUsers(listUsersQuerySchema.parse(request.query))),
  );

  app.post('/api/admin/users', manage, async (request, reply) => {
    const input = createUserRequestSchema.parse(request.body);
    const user = await service.createUser(currentActor(request), input);
    void reply.code(201);
    return okResponse(user);
  });

  app.get('/api/admin/users/:userId', manage, async (request) => {
    const { userId } = userIdParamsSchema.parse(request.params);
    return okResponse(await service.getUser(userId));
  });

  app.patch('/api/admin/users/:userId/status', manage, async (request) => {
    const { userId } = userIdParamsSchema.parse(request.params);
    const { disabled } = setUserDisabledRequestSchema.parse(request.body);
    return okResponse(await service.setDisabled(currentActor(request), userId, disabled));
  });

  app.put('/api/admin/users/:userId/roles/:roleId', manage, async (request) => {
    const { userId, roleId } = userRoleParamsSchema.parse(request.params);
    return okResponse(await service.assignRole(currentActor(request), userId, roleId));
  });

  app.delete('/api/admin/users/:userId/roles/:roleId', manage, async (request) => {
    const { userId, roleId } = userRoleParamsSchema.parse(request.params);
    return okResponse(await service.removeRole(currentActor(request), userId, roleId));
  });

  app.put('/api/admin/users/:userId/projects/:projectId', manage, async (request) => {
    const { userId, projectId } = userProjectParamsSchema.parse(request.params);
    return okResponse(await service.grantProject(currentActor(request), userId, projectId));
  });

  app.delete('/api/admin/users/:userId/projects/:projectId', manage, async (request) => {
    const { userId, projectId } = userProjectParamsSchema.parse(request.params);
    return okResponse(await service.revokeProject(currentActor(request), userId, projectId));
  });

  app.get('/api/admin/projects', manage, async () => okResponse(await service.listProjectRefs()));

  app.get(
    '/api/admin/roles',
    { onRequest: [authenticate, authorize('admin.roles.view')] },
    async () => okResponse(await service.listRoles()),
  );
}
