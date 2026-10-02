import type { ProjectStatus } from '@boq/shared';

/**
 * The one place project status transitions are defined. Pure, no I/O.
 * Completed and cancelled are final.
 */
const TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  planned: ['active', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** Every project starts here. */
export const INITIAL_PROJECT_STATUS: ProjectStatus = 'planned';

export function nextStatuses(from: ProjectStatus): ProjectStatus[] {
  return [...TRANSITIONS[from]];
}

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
