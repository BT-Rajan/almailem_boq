import { z } from 'zod';

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

export const USERS_PAGE_SIZE_MAX = 100;

export const listUsersQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(USERS_PAGE_SIZE_MAX).default(50),
  })
  .strict();
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
export type ProjectRef = { id: string; code: string; name: string };

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

export type AdminUserPage = {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
};

export type RoleWithPermissions = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
};
