import type {
  ApprovalItem,
  ApprovalPage,
  APPROVAL_SORTS,
  ApprovalStatus,
  ListParams,
} from '@boq/shared';
import { api, queryString } from './client';

const one = (id: string) => `/api/approvals/${encodeURIComponent(id)}`;

export const listApprovals = (
  p: ListParams<(typeof APPROVAL_SORTS)[number]> & { status: ApprovalStatus },
) => api<ApprovalPage>('GET', `/api/approvals${queryString(p)}`);
export const approveRequest = (id: string, comment: string) =>
  api<ApprovalItem>('POST', `${one(id)}/approve`, comment.trim() ? { comment } : {});
export const rejectRequest = (id: string, comment: string) =>
  api<ApprovalItem>('POST', `${one(id)}/reject`, { comment });
/** The requester withdraws their own request, through the expense's project. */
export const cancelApproval = (projectId: string, expenseId: string) =>
  api<ApprovalItem>(
    'POST',
    `/api/projects/${encodeURIComponent(projectId)}/expenses/${encodeURIComponent(expenseId)}/cancel-approval`,
  );
