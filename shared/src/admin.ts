import { z } from 'zod';
import { listQuerySchema, type Page } from './list-query';

/** Administration > Users and Roles. Request schemas validate on the server; response types type the UI. */

export const PASSWORD_MIN_LENGTH = 12;

/** Length only (NIST 800-63B): no composition rules. Capped so the hasher cannot be made to burn CPU. */
export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(1024);

export const createUserRequestSchema = z
  .object({
    email: z.string().trim().min(1).max(254).email(),
    name: z.string().trim().min(1).max(120),
    password: newPasswordSchema,
    roleIds: z.array(z.string().uuid()).max(20).default([]),
  })
  .strict();
export type CreateUserRequest = z.input<typeof createUserRequestSchema>;
export type CreateUserInput = z.infer<typeof createUserRequestSchema>;

export const setUserDisabledRequestSchema = z.object({ disabled: z.boolean() }).strict();
export type SetUserDisabledRequest = z.infer<typeof setUserDisabledRequestSchema>;

export const USER_SORTS = ['created', 'name', 'email'] as const;
export const listUsersQuerySchema = listQuerySchema(USER_SORTS);
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const userIdParamsSchema = z.object({ userId: z.string().uuid() });
export const userRoleParamsSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});
export const userProjectParamsSchema = z.object({
  userId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export type RoleRef = { id: string; name: string };
export type ProjectRef = { id: string; systemNo: string; name: string };

/** A user as the admin screens see it. Never carries the password hash. */
export type AdminUser = {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
  locked: boolean;
  roles: RoleRef[];
  createdAt: string;
};

export type AdminUserDetail = AdminUser & { projects: ProjectRef[] };

export type AdminUserPage = Page<AdminUser>;

export type RoleWithPermissions = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
};
