import {
  ATTACHMENT_NAME_HEADER,
  type BudgetProjection,
  type CostHeadDetail,
  type CreateExpenseRequest,
  type Expense,
  type ExpenseDetail,
  type EXPENSE_SORTS,
  type ListParams,
  type UpdateExpenseRequest,
} from '@boq/shared';
import { api, apiUpload, queryString } from './client';

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;
const one = (projectId: string, id: string) =>
  `${base(projectId)}/expenses/${encodeURIComponent(id)}`;

export const getCostHeadDetail = (
  projectId: string,
  costHeadId: string,
  p: ListParams<(typeof EXPENSE_SORTS)[number]>,
) =>
  api<CostHeadDetail>(
    'GET',
    `${base(projectId)}/cost-heads/${encodeURIComponent(costHeadId)}${queryString(p)}`,
  );
/** One expense with its project, cost head and history (deleted ones too, marked deleted). */
export const getExpenseDetail = (projectId: string, id: string) =>
  api<ExpenseDetail>('GET', one(projectId, id));
export const createExpense = (projectId: string, body: CreateExpenseRequest) =>
  api<Expense>('POST', `${base(projectId)}/expenses`, body);
export const updateExpense = (projectId: string, id: string, body: UpdateExpenseRequest) =>
  api<Expense>('PATCH', one(projectId, id), body);
/** Administrators only (server): the expense leaves every list and figure; its audit stays. */
export const deleteExpense = (projectId: string, id: string) =>
  api<{ deleted: true }>('DELETE', one(projectId, id));
export const reverseExpense = (projectId: string, id: string, reason: string) =>
  api<Expense>('POST', `${one(projectId, id)}/reverse`, { reason });
export const uploadAttachment = (projectId: string, id: string, file: File) =>
  apiUpload<Expense>(`${one(projectId, id)}/attachment`, file, ATTACHMENT_NAME_HEADER);
/** A plain link: the browser downloads it with the session cookie; the server checks access. */
export const attachmentUrl = (projectId: string, id: string) => `${one(projectId, id)}/attachment`;

export const getProjection = (projectId: string, costHeadId: string, amountFils: number) =>
  api<BudgetProjection>(
    'GET',
    `${base(projectId)}/cost-heads/${encodeURIComponent(costHeadId)}/projection${queryString({ amountFils })}`,
  );
