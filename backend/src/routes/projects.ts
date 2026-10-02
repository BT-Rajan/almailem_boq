import type { FastifyInstance } from 'fastify';
import {
  changeProjectStatusRequestSchema,
  createProjectRequestSchema,
  listProjectsQuerySchema,
  okResponse,
  projectIdParamsSchema,
  projectMemberParamsSchema,
  updateProjectRequestSchema,
  userLookupQuerySchema,
} from '@boq/shared';
import { currentActor, projectListScope } from '../auth/guards';
import type { DbPool } from '../db/pool';
import { createProjectService } from '../services/projects';

/** Projects and members. Thin: validate > guard (permission, then project access) > service. */
export function registerProjectRoutes(app: FastifyInstance, deps: { pool: DbPool }): void {
  const service = createProjectService(deps.pool);
  const { authenticate, authorize, authorizeProjectAccess } = app.guards;
  const onProject = (permission: Parameters<typeof authorize>[0]) => ({
    onRequest: [authenticate, authorize(permission), authorizeProjectAccess()],
  });

  app.get(
    '/api/projects',
    { onRequest: [authenticate, authorize('project.view')] },
    async (request) =>
      okResponse(
        await service.list(projectListScope(request), listProjectsQuerySchema.parse(request.query)),
      ),
  );

  app.post(
    '/api/projects',
    { onRequest: [authenticate, authorize('project.create')] },
    async (request, reply) => {
      const input = createProjectRequestSchema.parse(request.body);
      const project = await service.create(currentActor(request), input);
      void reply.code(201);
      return okResponse(project);
    },
  );

  app.get('/api/projects/:projectId', onProject('project.view'), async (request) => {
    const { projectId } = projectIdParamsSchema.parse(request.params);
    return okResponse(await service.get(projectId));
  });

  app.patch('/api/projects/:projectId', onProject('project.edit'), async (request) => {
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const patch = updateProjectRequestSchema.parse(request.body);
    return okResponse(await service.update(currentActor(request), projectId, patch));
  });

  app.post('/api/projects/:projectId/status', onProject('project.edit'), async (request) => {
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const { status } = changeProjectStatusRequestSchema.parse(request.body);
    return okResponse(await service.changeStatus(currentActor(request), projectId, status));
  });

  app.delete('/api/projects/:projectId', onProject('admin.projects.delete'), async (request) => {
    const { projectId } = projectIdParamsSchema.parse(request.params);
    await service.remove(currentActor(request), projectId);
    return okResponse({ deleted: true as const });
  });

  app.get('/api/projects/:projectId/members', onProject('project.view'), async (request) => {
    const { projectId } = projectIdParamsSchema.parse(request.params);
    return okResponse(await service.listMembers(projectId));
  });

  app.put(
    '/api/projects/:projectId/members/:userId',
    onProject('project.members.manage'),
    async (request) => {
      const { projectId, userId } = projectMemberParamsSchema.parse(request.params);
      return okResponse(await service.addMember(currentActor(request), projectId, userId));
    },
  );

  app.delete(
    '/api/projects/:projectId/members/:userId',
    onProject('project.members.manage'),
    async (request) => {
      const { projectId, userId } = projectMemberParamsSchema.parse(request.params);
      return okResponse(await service.removeMember(currentActor(request), projectId, userId));
    },
  );

  // Owner and member pickers. Anyone who may create projects or manage members needs it.
  app.get(
    '/api/users/lookup',
    { onRequest: [authenticate, authorize('project.members.manage')] },
    async (request) =>
      okResponse(await service.lookupUsers(userLookupQuerySchema.parse(request.query).search)),
  );
}
