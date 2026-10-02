import {
  createUserRequestSchema,
  type AdminUser,
  type AdminUserDetail,
  type AdminUserPage,
  type CreateUserInput,
  type ListUsersQuery,
  type PermissionCode,
  type ProjectRef,
  type RoleRef,
  type RoleWithPermissions,
} from '@boq/shared';
import { recordAudit, type AuditActor } from '../audit/record-audit';
import { hashPassword } from '../auth/passwords';
import type { DbPool, Db } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { AppError } from '../errors/app-error';
import {
  permissionsRepository,
  projectMembersRepository,
  projectsRepository,
  rolePermissionsRepository,
  rolesRepository,
  sessionsRepository,
  userRolesRepository,
  usersRepository,
  type UserRecord,
} from '../repositories';

/**
 * Administration of users, their roles and their project access.
 * This is the one module outside the repositories that reads roles, and it treats them as data:
 * it lists and assigns them by id and never compares a role's name.
 */

/** Whoever holds this permission can fix access for everyone else, so it must never reach zero holders. */
export const USER_ADMIN_PERMISSION: PermissionCode = 'admin.users.manage';

const lastAdminError = () =>
  new AppError('LAST_ADMIN', 'At least one enabled user must keep the right to manage users', 409);

const userEntity = (id: string) => ({ type: 'user', id });

function toAdminUser(user: UserRecord, roles: RoleRef[]): AdminUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    disabled: user.disabled,
    locked: user.locked,
    roles,
    createdAt: user.createdAt.toISOString(),
  };
}

async function requireUser(db: Db, userId: string): Promise<UserRecord> {
  const user = await usersRepository(db).findById(userId);
  if (!user) throw AppError.notFound('User not found');
  return user;
}

async function rolesOf(db: Db, userId: string): Promise<RoleRef[]> {
  return (await userRolesRepository(db).listForUsers([userId])).get(userId) ?? [];
}

/**
 * Run a change that might take user administration away from its last holder. The permission row
 * lock serialises such changes, so two admins removing each other at once cannot both succeed.
 * The change is applied first and checked after; a violation rolls it back.
 */
function guardLastAdmin<T>(pool: DbPool, change: (tx: Db) => Promise<T>): Promise<T> {
  return withTransaction(pool, async (tx) => {
    await permissionsRepository(tx).lockByCode(USER_ADMIN_PERMISSION);
    const result = await change(tx);
    if ((await usersRepository(tx).countEnabledHolding(USER_ADMIN_PERMISSION)) === 0) {
      throw lastAdminError();
    }
    return result;
  });
}

export function createUserAdminService(pool: DbPool) {
  return {
    async listUsers(query: ListUsersQuery): Promise<AdminUserPage> {
      const { page, pageSize } = query;
      const { rows, total } = await usersRepository(pool).list(query);
      const roles = await userRolesRepository(pool).listForUsers(rows.map((u) => u.id));
      return {
        items: rows.map((u) => toAdminUser(u, roles.get(u.id) ?? [])),
        total,
        page,
        pageSize,
      };
    },

    async getUser(userId: string): Promise<AdminUserDetail> {
      const user = await requireUser(pool, userId);
      return {
        ...toAdminUser(user, await rolesOf(pool, userId)),
        projects: await projectsRepository(pool).listRefsForMember(userId),
      };
    },

    /** `input` must already be validated with createUserRequestSchema. */
    async createUser(actor: AuditActor, input: CreateUserInput): Promise<AdminUserDetail> {
      const passwordHash = await hashPassword(input.password); // slow: keep it outside the transaction
      const roleIds = [...new Set(input.roleIds)];
      const created = await withTransaction(pool, async (tx) => {
        const user = await usersRepository(tx).create({
          email: input.email,
          name: input.name,
          passwordHash,
        });
        for (const roleId of roleIds) {
          if (!(await rolesRepository(tx).findById(roleId)))
            throw AppError.notFound('Role not found');
          await userRolesRepository(tx).assignIfMissing(user.id, roleId);
        }
        const roles = await rolesOf(tx, user.id);
        await recordAudit(tx, 'user.created', actor, userEntity(user.id), undefined, {
          email: user.email,
          name: user.name,
          roles: roles.map((r) => r.name),
        });
        return user;
      });
      return this.getUser(created.id);
    },

    async setDisabled(actor: AuditActor, userId: string, disabled: boolean): Promise<AdminUser> {
      const run = async (tx: Db) => {
        const user = await requireUser(tx, userId);
        if (user.disabled === disabled) return; // nothing to change, nothing to audit
        await usersRepository(tx).update(userId, { disabled });
        // A disabled user's sessions stop working at once anyway; removing them keeps the table honest.
        if (disabled) await sessionsRepository(tx).deleteAllForUser(userId);
        await recordAudit(
          tx,
          disabled ? 'user.disabled' : 'user.enabled',
          actor,
          userEntity(userId),
          { disabled: user.disabled },
          { disabled },
        );
      };
      // Only disabling can remove the last administrator.
      await (disabled ? guardLastAdmin(pool, run) : withTransaction(pool, run));
      const user = await requireUser(pool, userId);
      return toAdminUser(user, await rolesOf(pool, userId));
    },

    async assignRole(actor: AuditActor, userId: string, roleId: string): Promise<AdminUser> {
      await withTransaction(pool, async (tx) => {
        await requireUser(tx, userId);
        if (!(await rolesRepository(tx).findById(roleId)))
          throw AppError.notFound('Role not found');
        const before = await rolesOf(tx, userId);
        if (!(await userRolesRepository(tx).assignIfMissing(userId, roleId))) return;
        const after = await rolesOf(tx, userId);
        await recordAudit(
          tx,
          'user.role_assigned',
          actor,
          userEntity(userId),
          {
            roles: before.map((r) => r.name),
          },
          { roles: after.map((r) => r.name) },
        );
      });
      return toAdminUser(await requireUser(pool, userId), await rolesOf(pool, userId));
    },

    async removeRole(actor: AuditActor, userId: string, roleId: string): Promise<AdminUser> {
      await guardLastAdmin(pool, async (tx) => {
        await requireUser(tx, userId);
        const before = await rolesOf(tx, userId);
        if (!(await userRolesRepository(tx).remove(userId, roleId))) return;
        const after = await rolesOf(tx, userId);
        await recordAudit(
          tx,
          'user.role_removed',
          actor,
          userEntity(userId),
          {
            roles: before.map((r) => r.name),
          },
          { roles: after.map((r) => r.name) },
        );
      });
      return toAdminUser(await requireUser(pool, userId), await rolesOf(pool, userId));
    },

    async grantProject(
      actor: AuditActor,
      userId: string,
      projectId: string,
    ): Promise<ProjectRef[]> {
      await withTransaction(pool, async (tx) => {
        await requireUser(tx, userId);
        const project = await projectsRepository(tx).findById(projectId);
        if (!project) throw AppError.notFound('Project not found');
        if (!(await projectMembersRepository(tx).addIfMissing(projectId, userId))) return;
        await recordAudit(tx, 'user.project_granted', actor, userEntity(userId), undefined, {
          project: { id: project.id, code: project.code },
        });
      });
      return projectsRepository(pool).listRefsForMember(userId);
    },

    async revokeProject(
      actor: AuditActor,
      userId: string,
      projectId: string,
    ): Promise<ProjectRef[]> {
      await withTransaction(pool, async (tx) => {
        await requireUser(tx, userId);
        const project = await projectsRepository(tx).findById(projectId, { includeDeleted: true });
        if (!(await projectMembersRepository(tx).remove(projectId, userId))) return;
        await recordAudit(
          tx,
          'user.project_revoked',
          actor,
          userEntity(userId),
          { project: { id: projectId, code: project?.code ?? null } },
          undefined,
        );
      });
      return projectsRepository(pool).listRefsForMember(userId);
    },

    async listRoles(): Promise<RoleWithPermissions[]> {
      const [roles, codes] = await Promise.all([
        rolesRepository(pool).list(),
        rolePermissionsRepository(pool).listCodesByRole(),
      ]);
      return roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        permissions: codes.get(r.id) ?? [],
      }));
    },

    /** Live projects, for the grant-access picker. */
    listProjectRefs(): Promise<ProjectRef[]> {
      return projectsRepository(pool).listRefs();
    },

    /**
     * First-run setup (operator CLI): create a user holding every role that grants user
     * administration. Refused once any enabled user can manage users, so it cannot be used
     * to slip in a second administrator later.
     */
    /** Is there already an enabled user who can manage users? Then first-run setup is over. */
    async hasAdministrator(): Promise<boolean> {
      return (await usersRepository(pool).countEnabledHolding(USER_ADMIN_PERMISSION)) > 0;
    },

    async bootstrapAdmin(input: { email: string; name: string; password: string }) {
      if (await this.hasAdministrator()) {
        throw AppError.conflict('An administrator already exists; use the admin screens');
      }
      const codes = await rolePermissionsRepository(pool).listCodesByRole();
      const roleIds = [...codes]
        .filter(([, c]) => c.includes(USER_ADMIN_PERMISSION))
        .map(([id]) => id);
      if (!roleIds.length)
        throw AppError.conflict('No role grants user administration; run the seed');
      return this.createUser(null, createUserRequestSchema.parse({ ...input, roleIds }));
    },
  };
}

export type UserAdminService = ReturnType<typeof createUserAdminService>;
