import type {
  AdminUser,
  AdminUserDetail,
  AdminUserPage,
  CostHead,
  CreateCostHeadRequest,
  ListParams,
  CreateUserRequest,
  ProjectRef,
  RoleWithPermissions,
  UpdateCostHeadRequest,
  USER_SORTS,
} from '@boq/shared';
import { api, queryString } from './client';

const user = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;

export const listUsers = (p: ListParams<(typeof USER_SORTS)[number]>) =>
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

export const listCostHeads = () => api<CostHead[]>('GET', '/api/admin/cost-heads');
export const createCostHead = (body: CreateCostHeadRequest) =>
  api<CostHead>('POST', '/api/admin/cost-heads', body);
export const updateCostHead = (id: string, body: UpdateCostHeadRequest) =>
  api<CostHead>('PATCH', `/api/admin/cost-heads/${encodeURIComponent(id)}`, body);
export const reorderCostHeads = (ids: string[]) =>
  api<CostHead[]>('PUT', '/api/admin/cost-heads/order', { ids });
