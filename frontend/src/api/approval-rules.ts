import type { ThresholdSettings, Thresholds } from '@boq/shared';
import { api } from './client';

export const getApprovalRules = () => api<ThresholdSettings>('GET', '/api/admin/approval-rules');
export const setApprovalRules = (body: Thresholds) =>
  api<ThresholdSettings>('PUT', '/api/admin/approval-rules', body);
