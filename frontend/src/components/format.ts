import type { ProjectStatus } from '@boq/shared';

/** Display text only. Formatting lives at the UI edge; no rules here. */
const STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export const statusLabel = (s: ProjectStatus): string => STATUS_LABELS[s];

/** '2026-01-31' -> '31/01/2026' (Kuwait style), '' for no date. */
export const formatDate = (iso: string | null): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
