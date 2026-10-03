import {
  datesInOrder,
  DATE_ORDER_MESSAGE,
  projectStatusSchema,
  type CreateProjectInput,
  type ListProjectsQuery,
  type ProjectDetail,
  type ProjectMember,
  type ProjectPage,
  type ProjectStatus,
  type UpdateProjectInput,
  type UserRef,
} from '@boq/shared';
import { recordAudit, type AuditActor } from '../audit/record-audit';
import { ALL_PROJECTS_PERMISSION } from '../auth/guards';
import type { Db, DbPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { canTransition, INITIAL_PROJECT_STATUS, nextStatuses } from '../domain/project-status';
import { AppError } from '../errors/app-error';
import {
  projectMembersRepository,
  projectsRepository,
  usersRepository,
  type ProjectRecord,
} from '../repositories';

/**
 * Projects: details, status and members. No money here (estimates arrive in Chunk 07).
 * Access is checked by the route guards before any of this runs; this module trusts that.
 */

const LOOKUP_LIMIT = 20;
const projectEntity = (id: string) => ({ type: 'project', id });
const EDITABLE = ['name', 'ownerUserId', 'startDate', 'endDate', 'description'] as const;

/** Statuses are free text in the database; anything unknown is a data fault, not user input. */
const statusOf = (p: ProjectRecord): ProjectStatus => projectStatusSchema.parse(p.status);

async function requireProject(db: Db, id: string): Promise<ProjectRecord> {
  const p = await projectsRepository(db).findById(id);
  if (!p) throw AppError.notFound('Project not found');
  return p;
}

/** Owners and new members must be enabled, live users. */
async function requireActiveUser(db: Db, userId: string, label: string): Promise<void> {
  const u = await usersRepository(db).findById(userId);
  if (!u || u.disabled) throw AppError.validation(`${label} must be an active user`);
}

export function createProjectService(pool: DbPool) {
  async function detail(db: Db, p: ProjectRecord): Promise<ProjectDetail> {
    const owner = await usersRepository(db).findById(p.ownerUserId, { includeDeleted: true });
    const status = statusOf(p);
    return {
      id: p.id,
      systemNo: p.systemNo,
      name: p.name,
      status,
      ownerUserId: p.ownerUserId,
      ownerName: owner?.name ?? '',
      startDate: p.startDate,
      endDate: p.endDate,
      description: p.description,
      nextStatuses: nextStatuses(status),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  return {
    async list(
      scope: { memberUserId: string | null },
      query: ListProjectsQuery,
    ): Promise<ProjectPage> {
      const { page, pageSize } = query;
      const { rows, total } = await projectsRepository(pool).list(scope.memberUserId, query);
      return {
        items: rows.map((p) => ({
          id: p.id,
          systemNo: p.systemNo,
          name: p.name,
          status: statusOf(p),
          ownerName: p.ownerName,
          startDate: p.startDate,
          endDate: p.endDate,
        })),
        total,
        page,
        pageSize,
      };
    },

    async get(id: string): Promise<ProjectDetail> {
      return detail(pool, await requireProject(pool, id));
    },

    /**
     * Step 1 of the Create Project flow (Details). Owner and creator become members.
     * Seam: the BoQ (estimates) and Review steps of Chunk 07 build on the project this returns.
     */
    async create(actor: { userId: string }, input: CreateProjectInput): Promise<ProjectDetail> {
      const ownerUserId = input.ownerUserId ?? actor.userId;
      return withTransaction(pool, async (tx) => {
        await requireActiveUser(tx, ownerUserId, 'Owner');
        const p = await projectsRepository(tx).create({
          name: input.name,
          ownerUserId,
          status: INITIAL_PROJECT_STATUS,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          description: input.description ?? null,
        });
        // Owner and creator both belong, so the creator can still open what they just made.
        await projectMembersRepository(tx).addIfMissing(p.id, ownerUserId);
        await projectMembersRepository(tx).addIfMissing(p.id, actor.userId);
        await recordAudit(tx, 'project.created', actor, projectEntity(p.id), undefined, {
          systemNo: p.systemNo,
          name: p.name,
          ownerUserId,
          status: p.status,
          startDate: p.startDate,
          endDate: p.endDate,
          description: p.description,
        });
        return detail(tx, p);
      });
    },

    async update(actor: AuditActor, id: string, patch: UpdateProjectInput): Promise<ProjectDetail> {
      return withTransaction(pool, async (tx) => {
        const current = await requireProject(tx, id);
        // Dates are checked against what the project will look like, not just the patch.
        const start = patch.startDate !== undefined ? patch.startDate : current.startDate;
        const end = patch.endDate !== undefined ? patch.endDate : current.endDate;
        if (!datesInOrder(start, end)) {
          throw AppError.validation('Invalid input', [
            { path: 'endDate', message: DATE_ORDER_MESSAGE },
          ]);
        }
        const changed = EDITABLE.filter((f) => patch[f] !== undefined && patch[f] !== current[f]);
        if (!changed.length) return detail(tx, current);

        if (patch.ownerUserId !== undefined && changed.includes('ownerUserId')) {
          await requireActiveUser(tx, patch.ownerUserId, 'Owner');
          await projectMembersRepository(tx).addIfMissing(id, patch.ownerUserId);
        }
        const before = Object.fromEntries(changed.map((f) => [f, current[f]]));
        const after = Object.fromEntries(changed.map((f) => [f, patch[f]]));
        await projectsRepository(tx).update(id, after);
        await recordAudit(tx, 'project.updated', actor, projectEntity(id), before, after);
        return detail(tx, await requireProject(tx, id));
      });
    },

    async changeStatus(actor: AuditActor, id: string, to: ProjectStatus): Promise<ProjectDetail> {
      return withTransaction(pool, async (tx) => {
        const current = await requireProject(tx, id);
        const from = statusOf(current);
        if (!canTransition(from, to)) {
          throw new AppError('INVALID_TRANSITION', `A ${from} project cannot become ${to}`, 409);
        }
        await projectsRepository(tx).update(id, { status: to });
        await recordAudit(
          tx,
          'project.status_changed',
          actor,
          projectEntity(id),
          { status: from },
          { status: to },
        );
        return detail(tx, await requireProject(tx, id));
      });
    },

    async remove(actor: AuditActor, id: string): Promise<void> {
      await withTransaction(pool, async (tx) => {
        const current = await requireProject(tx, id);
        await projectsRepository(tx).softDelete(id);
        await recordAudit(tx, 'project.deleted', actor, projectEntity(id), {
          systemNo: current.systemNo,
          name: current.name,
          status: current.status,
        });
      });
    },

    async listMembers(id: string): Promise<ProjectMember[]> {
      const p = await requireProject(pool, id);
      const rows = await projectMembersRepository(pool).listMembers(id, ALL_PROJECTS_PERMISSION);
      return rows.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        isOwner: m.id === p.ownerUserId,
        removable: m.stored && m.id !== p.ownerUserId,
      }));
    },

    async addMember(actor: AuditActor, id: string, userId: string): Promise<ProjectMember[]> {
      await withTransaction(pool, async (tx) => {
        await requireProject(tx, id);
        await requireActiveUser(tx, userId, 'Member');
        if (!(await projectMembersRepository(tx).addIfMissing(id, userId))) return;
        await recordAudit(tx, 'project.member_added', actor, projectEntity(id), undefined, {
          userId,
        });
      });
      return this.listMembers(id);
    },

    async removeMember(actor: AuditActor, id: string, userId: string): Promise<ProjectMember[]> {
      await withTransaction(pool, async (tx) => {
        const p = await requireProject(tx, id);
        if (p.ownerUserId === userId) {
          throw AppError.conflict('The owner cannot be removed. Change the owner first.');
        }
        if (!(await projectMembersRepository(tx).remove(id, userId))) return;
        await recordAudit(
          tx,
          'project.member_removed',
          actor,
          projectEntity(id),
          { userId },
          undefined,
        );
      });
      return this.listMembers(id);
    },

    /** Enabled users for the owner and member pickers. */
    lookupUsers(search: string | undefined): Promise<UserRef[]> {
      return usersRepository(pool).lookup(search || undefined, LOOKUP_LIMIT);
    },
  };
}
