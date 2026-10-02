import { z } from 'zod';
import type { BudgetMetrics } from './budget';
import type { BudgetStatus } from './control';
import type { ProjectStatus } from './projects';

/** Home dashboard. Every figure and status is the server's (domain/metrics, domain/control). */
export type DashboardProject = {
  id: string;
  code: string;
  name: string;
  projectStatus: ProjectStatus;
  metrics: BudgetMetrics;
  status: BudgetStatus;
};

export type Dashboard = {
  summary: { projects: number; metrics: BudgetMetrics; status: BudgetStatus };
  projects: DashboardProject[];
};

/** BoQ row order: the usual display order, or heads needing attention first. */
export const boqQuerySchema = z
  .object({ order: z.enum(['display', 'attention']).default('display') })
  .strict();
export type BoqOrder = z.infer<typeof boqQuerySchema>['order'];
