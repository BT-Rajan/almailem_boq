import type { BoqOrder, ProjectBoq, SetEstimatesRequest } from '@boq/shared';
import { api, queryString } from './client';

const project = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const getBoq = (projectId: string, order: BoqOrder = 'display') =>
  api<ProjectBoq>(
    'GET',
    `${project(projectId)}/boq${queryString({ order: order === 'display' ? undefined : order })}`,
  );
export const setEstimates = (projectId: string, body: SetEstimatesRequest) =>
  api<ProjectBoq>('PUT', `${project(projectId)}/estimates`, body);
