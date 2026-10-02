import { fils, projectStatusSchema, type ProjectBoq, type SetEstimatesRequest } from '@boq/shared';
import { recordAudit, type AuditActor } from '../audit/record-audit';
import type { Db, DbPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { budgetMetrics, NO_SPEND, totalMetrics } from '../domain/metrics';
import { allowsBudgetChanges } from '../domain/project-status';
import { AppError } from '../errors/app-error';
import { costHeadsRepository, estimatesRepository, projectsRepository } from '../repositories';

/**
 * Project BoQ: the budget (estimate) per cost head, with metrics from domain/metrics.
 * Actual is zero until expenses exist (Chunk 08).
 */

async function requireProject(db: Db, id: string) {
  const p = await projectsRepository(db).findById(id);
  if (!p) throw AppError.notFound('Project not found');
  return { ...p, status: projectStatusSchema.parse(p.status) };
}

async function boq(db: Db, projectId: string): Promise<ProjectBoq> {
  const project = await requireProject(db, projectId);
  const [heads, budgets] = await Promise.all([
    costHeadsRepository(db).list({ includeInactive: true }),
    estimatesRepository(db).listForProject(projectId),
  ]);
  // Active heads, plus any inactive head that still carries a budget, so totals stay honest.
  const shown = heads.filter((h) => h.active || (budgets.get(h.id) ?? 0) !== 0);
  const lines = shown.map((h) => ({
    head: h,
    figures: { budget: budgets.get(h.id) ?? fils(0), actual: NO_SPEND },
  }));
  return {
    rows: lines.map(({ head, figures }) => ({
      costHead: { id: head.id, code: head.code, name: head.name, active: head.active },
      metrics: budgetMetrics(figures),
    })),
    total: totalMetrics(lines.map((l) => l.figures)),
    editable: allowsBudgetChanges(project.status),
  };
}

export function createEstimateService(pool: DbPool) {
  return {
    getBoq(projectId: string): Promise<ProjectBoq> {
      return boq(pool, projectId);
    },

    /**
     * Set budgets for some heads in one transaction. Each real change writes one audit row with
     * before/after; unchanged rows write nothing. 0 clears a budget.
     */
    async setEstimates(
      actor: AuditActor,
      projectId: string,
      request: SetEstimatesRequest,
    ): Promise<ProjectBoq> {
      return withTransaction(pool, async (tx) => {
        // Lock the project first: concurrent budget edits on it run one after the other.
        const locked = await projectsRepository(tx).lockById(projectId);
        if (!locked) throw AppError.notFound('Project not found');
        const project = { ...locked, status: projectStatusSchema.parse(locked.status) };
        if (!allowsBudgetChanges(project.status)) {
          throw new AppError(
            'BUDGET_LOCKED',
            `Budgets of a ${project.status} project cannot change`,
            409,
          );
        }
        const estimates = estimatesRepository(tx);
        const current = await estimates.listForProject(projectId);
        for (const row of request.estimates) {
          const head = await costHeadsRepository(tx).findById(row.costHeadId);
          if (!head) throw AppError.notFound('Cost head not found');
          const amount = fils(row.amountFils);
          if (!head.active && amount !== 0) {
            throw AppError.conflict(`Cost head ${head.code} is inactive and cannot take a budget`);
          }
          const before = current.get(head.id) ?? fils(0);
          if (before === amount) continue;
          await estimates.upsert(projectId, head.id, amount);
          await recordAudit(
            tx,
            'estimate.changed',
            actor,
            { type: 'project', id: projectId },
            { costHeadId: head.id, code: head.code, amountFils: before },
            { costHeadId: head.id, code: head.code, amountFils: amount },
          );
        }
        return boq(tx, projectId);
      });
    },
  };
}
