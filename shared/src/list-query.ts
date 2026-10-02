import { z } from 'zod';
import type { Fils } from './money';

/**
 * The one search / filter / sort / page pattern for lists. Each list names its allowed sort keys
 * and filters; anything else in the query string is refused (strict), so callers can never steer
 * SQL. The server maps each key to fixed SQL (backend/src/query).
 */
export const PAGE_SIZE_MAX = 100;
export const PAGE_SIZE_DEFAULT = 50;
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export function listQuerySchema<S extends string, F extends z.ZodRawShape = Record<never, never>>(
  sorts: readonly [S, ...S[]],
  filters?: F,
) {
  return z
    .object({
      q: z.string().trim().max(100).optional(),
      sort: z.enum(sorts as [S, ...S[]]).optional(),
      dir: z.enum(SORT_DIRECTIONS).optional(),
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
      ...(filters ?? ({} as F)),
    })
    .strict();
}

/** What a list query string can carry, as the UI builds it. */
export type ListParams<S extends string = string> = {
  q?: string;
  sort?: S;
  dir?: SortDirection;
  page?: number;
  pageSize?: number;
};

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

/** Global search: the header box. Grouped, each group already limited to what the user may see. */
export const globalSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) }).strict();
export type SearchHit = {
  projectId: string;
  projectCode: string;
  costHeadId: string;
  expenseId: string;
  vendor: string;
  invoiceNo: string;
  expenseDate: string;
  amountFils: Fils;
  description: string | null;
};
export type SearchResults = {
  projects: { id: string; code: string; name: string }[];
  costHeads: { id: string; code: string; name: string; active: boolean }[];
  invoices: SearchHit[];
  vendors: { vendor: string; expenses: number; projects: number }[];
  expenses: SearchHit[];
};
