import type { ProjectBoq, SetEstimatesRequest } from '@boq/shared';
import { api } from './client';

const project = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const getBoq = (projectId: string) => api<ProjectBoq>('GET', `${project(projectId)}/boq`);
export const setEstimates = (projectId: string, body: SetEstimatesRequest) =>
  api<ProjectBoq>('PUT', `${project(projectId)}/estimates`, body);
