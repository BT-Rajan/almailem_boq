import type {
  AdminUser,
  AdminUserDetail,
  AdminUserPage,
  CreateUserRequest,
  ProjectRef,
  RoleWithPermissions,
} from '@boq/shared';
import { api, queryString } from './client';

const user = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;

export const listUsers = (p: { search?: string; page?: number; pageSize?: number }) =>
  api<AdminUserPage>('GET', `/api/admin/users${queryString(p)}`);
export const getUser = (id: string) => api<AdminUserDetail>('GET', user(id));
export const createUser = (body: CreateUserRequest) =>
  api<AdminUserDetail>('POST', '/api/admin/users', body);
export const setUserDisabled = (id: string, disabled: boolean) =>
  api<AdminUser>('PATCH', `${user(id)}/status`, { disabled });
export const assignRole = (id: string, roleId: string) =>
  api<AdminUser>('PUT', `${user(id)}/roles/${encodeURIComponent(roleId)}`);
export const removeRole = (id: string, roleId: string) =>
  api<AdminUser>('DELETE', `${user(id)}/roles/${encodeURIComponent(roleId)}`);
export const grantProject = (id: string, projectId: string) =>
  api<ProjectRef[]>('PUT', `${user(id)}/projects/${encodeURIComponent(projectId)}`);
export const revokeProject = (id: string, projectId: string) =>
  api<ProjectRef[]>('DELETE', `${user(id)}/projects/${encodeURIComponent(projectId)}`);
export const listRoles = () => api<RoleWithPermissions[]>('GET', '/api/admin/roles');
export const listProjects = () => api<ProjectRef[]>('GET', '/api/admin/projects');
