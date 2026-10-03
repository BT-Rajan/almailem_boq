import {
  fils,
  projectStatusSchema,
  type BoqOrder,
  type ProjectBoq,
  type SetEstimatesRequest,
} from '@boq/shared';
import { recordAudit, type AuditActor } from '../audit/record-audit';
import type { Db, DbPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { byUrgency, calculateBudgetStatus } from '../domain/control';
import { budgetMetrics, totalMetrics } from '../domain/metrics';
import { acceptsFinancialChanges } from '../domain/project-status';
import { AppError } from '../errors/app-error';
import {
  costHeadsRepository,
  estimatesRepository,
  expensesRepository,
  projectsRepository,
  thresholdsRepository,
} from '../repositories';

/**
 * Project BoQ: budget (estimate) and actual (expenses) per cost head, measured by domain/metrics.
 */

async function requireProject(db: Db, id: string) {
  const p = await projectsRepository(db).findById(id);
  if (!p) throw AppError.notFound('Project not found');
  return { ...p, status: projectStatusSchema.parse(p.status) };
}

/**
 * The project's figures per cost head and in total. The BoQ table and the cost-head detail both
 * read this, so they always agree.
 */
export async function loadBoq(
  db: Db,
  projectId: string,
  order: BoqOrder = 'display',
): Promise<ProjectBoq> {
  const project = await requireProject(db, projectId);
  const [heads, budgets, actuals, thresholds] = await Promise.all([
    costHeadsRepository(db).list({ includeInactive: true }),
    estimatesRepository(db).listForProject(projectId),
    expensesRepository(db).actualsByHead(projectId),
    thresholdsRepository(db).get(),
  ]);
  // Active heads, plus any inactive head that still carries a budget or spend, so totals stay honest.
  const shown = heads.filter(
    (h) => h.active || (budgets.get(h.id) ?? 0) !== 0 || (actuals.get(h.id) ?? 0) !== 0,
  );
  const lines = shown.map((h) => ({
    head: h,
    figures: { budget: budgets.get(h.id) ?? fils(0), actual: actuals.get(h.id) ?? fils(0) },
  }));
  const total = totalMetrics(lines.map((l) => l.figures));
  const rows = lines.map(({ head, figures }) => {
    const metrics = budgetMetrics(figures);
    return {
      costHead: {
        id: head.id,
        systemNo: head.systemNo,
        code: head.code,
        name: head.name,
        active: head.active,
      },
      metrics,
      status: calculateBudgetStatus(metrics.utilisationBp, thresholds),
    };
  });
  return {
    rows: order === 'attention' ? byUrgency(rows, (r) => r.status) : rows,
    total,
    totalStatus: calculateBudgetStatus(total.utilisationBp, thresholds),
    editable: acceptsFinancialChanges(project.status),
  };
}

/** Lock the project row and check its budgets may still change. */
export async function lockProjectForBudget(tx: Db, projectId: string): Promise<void> {
  const locked = await projectsRepository(tx).lockById(projectId);
  if (!locked) throw AppError.notFound('Project not found');
  const status = projectStatusSchema.parse(locked.status);
  if (!acceptsFinancialChanges(status)) {
    throw new AppError('PROJECT_CLOSED', `Budgets of a ${status} project cannot change`, 409);
  }
}

/**
 * Write budgets (the authoritative project_estimates) for some heads, inside the caller's
 * transaction with the project locked. Each real change writes one audit row with before/after;
 * unchanged rows write nothing.
 */
export async function writeEstimates(
  tx: Db,
  actor: AuditActor,
  projectId: string,
  rows: { costHeadId: string; amountFils: number }[],
  opts: { rowIsMembership?: boolean } = {},
): Promise<void> {
  const estimates = estimatesRepository(tx);
  const current = await estimates.listForProject(projectId);
  for (const row of rows) {
    const head = await costHeadsRepository(tx).findById(row.costHeadId);
    if (!head) throw AppError.notFound('Cost head not found');
    const amount = fils(row.amountFils);
    // For a structure (opts.rowIsMembership), no row means "not in the budget", which differs
    // from a selected head with a budget of 0; for a direct edit, no row is simply 0.
    const stored = current.get(head.id);
    const before = stored ?? (opts.rowIsMembership ? null : fils(0));
    if (before === amount) continue; // unchanged, even on a head retired since
    if (!head.active && amount !== 0) {
      throw AppError.conflict(`Cost head ${head.code} is inactive and cannot take a budget`);
    }
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
}

export function createEstimateService(pool: DbPool) {
  return {
    getBoq(projectId: string, order: BoqOrder = 'display'): Promise<ProjectBoq> {
      return loadBoq(pool, projectId, order);
    },

    /**
     * Set budgets for some heads in one transaction (administrators only: everyone else proposes
     * a cost structure for approval). 0 clears a budget.
     */
    async setEstimates(
      actor: AuditActor,
      projectId: string,
      request: SetEstimatesRequest,
    ): Promise<ProjectBoq> {
      return withTransaction(pool, async (tx) => {
        // Lock the project first: concurrent budget edits on it run one after the other.
        await lockProjectForBudget(tx, projectId);
        await writeEstimates(tx, actor, projectId, request.estimates);
        return loadBoq(tx, projectId);
      });
    },
  };
}
