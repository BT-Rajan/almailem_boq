import { projectStatusSchema, type Dashboard } from '@boq/shared';
import type { DbPool } from '../db/pool';
import { calculateBudgetStatus } from '../domain/control';
import { budgetMetrics } from '../domain/metrics';
import { approvalsRepository, dashboardRepository, thresholdsRepository } from '../repositories';

/**
 * Home dashboard: aggregation only. Sums come from SQL (one query per widget); every derived figure
 * from domain/metrics and every status from domain/control. No calculation of its own.
 * Pending approvals counts the requests waiting for a decision in the user's projects.
 */
export function createDashboardService(pool: DbPool) {
  return {
    async get(scope: { memberUserId: string | null }): Promise<Dashboard> {
      const repo = dashboardRepository(pool);
      const [summary, projects, thresholds, pendingApprovals] = await Promise.all([
        repo.summary(scope.memberUserId),
        repo.projectTotals(scope.memberUserId),
        thresholdsRepository(pool).get(),
        approvalsRepository(pool).countPending(scope.memberUserId),
      ]);
      const measure = (budget: typeof summary.budget, actual: typeof summary.actual) => {
        const metrics = budgetMetrics({ budget, actual });
        return { metrics, status: calculateBudgetStatus(metrics.utilisationBp, thresholds) };
      };
      return {
        summary: {
          projects: summary.projects,
          pendingApprovals,
          ...measure(summary.budget, summary.actual),
        },
        projects: projects.map((p) => ({
          id: p.id,
          systemNo: p.systemNo,
          code: p.code,
          name: p.name,
          projectStatus: projectStatusSchema.parse(p.status),
          ...measure(p.budget, p.actual),
        })),
      };
    },
  };
}
