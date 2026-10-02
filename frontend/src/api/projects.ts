import type {
  CreateProjectRequest,
  ProjectDetail,
  ProjectMember,
  ProjectPage,
  ProjectStatus,
  UpdateProjectRequest,
  UserRef,
} from '@boq/shared';
import { api, queryString } from './client';

const project = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const listProjects = (p: { search?: string; page?: number; pageSize?: number }) =>
  api<ProjectPage>('GET', `/api/projects${queryString(p)}`);
export const getProject = (id: string) => api<ProjectDetail>('GET', project(id));
export const createProject = (body: CreateProjectRequest) =>
  api<ProjectDetail>('POST', '/api/projects', body);
export const updateProject = (id: string, body: UpdateProjectRequest) =>
  api<ProjectDetail>('PATCH', project(id), body);
export const changeProjectStatus = (id: string, status: ProjectStatus) =>
  api<ProjectDetail>('POST', `${project(id)}/status`, { status });
export const deleteProject = (id: string) => api('DELETE', project(id));
export const listMembers = (id: string) => api<ProjectMember[]>('GET', `${project(id)}/members`);
export const addMember = (id: string, userId: string) =>
  api<ProjectMember[]>('PUT', `${project(id)}/members/${encodeURIComponent(userId)}`);
export const removeMember = (id: string, userId: string) =>
  api<ProjectMember[]>('DELETE', `${project(id)}/members/${encodeURIComponent(userId)}`);
export const lookupUsers = (search: string) =>
  api<UserRef[]>('GET', `/api/users/lookup${queryString({ search })}`);
