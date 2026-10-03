import type {
  BudgetProposal,
  BudgetProposalPage,
  BUDGET_APPROVAL_SORTS,
  ApprovalStatus,
  CostStructure,
  ListParams,
  SubmitBudgetRequest,
} from '@boq/shared';
import { api, queryString } from './client';

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/cost-structure`;

/** The approved budget, the heads that must stay in it, and the latest request. */
export const getCostStructure = (projectId: string) => api<CostStructure>('GET', base(projectId));
/** Propose the whole structure; the approved budget is untouched until an admin approves. */
export const submitCostStructure = (projectId: string, body: SubmitBudgetRequest) =>
  api<BudgetProposal>('POST', `${base(projectId)}/proposals`, body);
/** Administrators: budget requests. Decisions use the shared approve/reject (api/approvals). */
export const listCostStructureApprovals = (
  p: ListParams<(typeof BUDGET_APPROVAL_SORTS)[number]> & { status: ApprovalStatus },
) => api<BudgetProposalPage>('GET', `/api/approvals/cost-structures${queryString(p)}`);
