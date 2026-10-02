import {
  fils,
  projectStatusSchema,
  type BudgetProjection,
  type Fils,
  type ProjectBoq,
  type ProjectStatus,
  type Thresholds,
} from '@boq/shared';
import type { Db } from '../db/pool';
import { calculateBudgetStatus, projectedStatus } from '../domain/control';
import { budgetMetrics } from '../domain/metrics';
import { acceptsFinancialChanges } from '../domain/project-status';
import { AppError } from '../errors/app-error';
import { projectsRepository, thresholdsRepository } from '../repositories';
import { loadBoq } from './estimates';

/**
 * Spend changes shared by expenses and approvals: project locking, and what a sum of money would
 * do to a head. Figures come from the BoQ (so they match it) and statuses from domain/control.
 * Lock order everywhere: project row, then expense row, then approval row.
 */

/** Lock the project row (it serialises every spend change in the project). */
export async function lockProject(tx: Db, projectId: string): Promise<ProjectStatus> {
  const p = await projectsRepository(tx).lockById(projectId);
  if (!p) throw AppError.notFound('Project not found');
  return projectStatusSchema.parse(p.status);
}

/** Lock the project and check it still accepts spend changes. */
export async function lockOpenProject(tx: Db, projectId: string): Promise<void> {
  const status = await lockProject(tx, projectId);
  if (!acceptsFinancialChanges(status)) {
    throw new AppError('PROJECT_CLOSED', `A ${status} project's spend cannot change`, 409);
  }
}

/**
 * One head's row from the project figures. A head the BoQ does not show (inactive, no budget, no
 * spend) has zero figures.
 */
export function headRow(boq: ProjectBoq, costHeadId: string, thresholds: Thresholds) {
  const row = boq.rows.find((r) => r.costHead.id === costHeadId);
  if (row) return { metrics: row.metrics, status: row.status };
  const metrics = budgetMetrics({ budget: fils(0), actual: fils(0) });
  return { metrics, status: calculateBudgetStatus(metrics.utilisationBp, thresholds) };
}

/** The head now, and after adding `amount` (negative for less), from the control engine. */
export function projectOnto(
  boq: ProjectBoq,
  costHeadId: string,
  amount: Fils,
  thresholds: Thresholds,
): BudgetProjection {
  const current = headRow(boq, costHeadId, thresholds);
  return {
    current,
    projected: projectedStatus(
      { budget: current.metrics.budget, currentActual: current.metrics.actual, newAmount: amount },
      thresholds,
    ),
  };
}

/** What adding `amount` to this head would do, read in `db` (inside a transaction when deciding). */
export async function projectSpend(
  db: Db,
  projectId: string,
  costHeadId: string,
  amount: Fils,
): Promise<BudgetProjection> {
  const [boq, thresholds] = await Promise.all([
    loadBoq(db, projectId),
    thresholdsRepository(db).get(),
  ]);
  return projectOnto(boq, costHeadId, amount, thresholds);
}
