import { z } from 'zod';
import { listQuerySchema, type Page } from './list-query';

/** Projects: details and members only. No money lives on a project (budgets are estimates, Chunk 07). */

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const projectStatusSchema = z.enum(PROJECT_STATUSES);

/** A real calendar date as 'YYYY-MM-DD' (rejects 2026-02-30). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Not a real date');

/** The one date rule: when both dates are set, the end must be after the start. */
export const datesInOrder = (start: string | null | undefined, end: string | null | undefined) =>
  !start || !end || end > start;
const DATE_ORDER_MESSAGE = 'End date must be after the start date';

export const projectCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/, 'Use letters, digits and . _ / -');

const fields = {
  name: z.string().trim().min(1).max(200),
  ownerUserId: z.string().uuid(),
  startDate: isoDateSchema.nullable(),
  endDate: isoDateSchema.nullable(),
  description: z.string().trim().max(5000).nullable(),
};

export const createProjectRequestSchema = z
  .object({
    code: projectCodeSchema,
    name: fields.name,
    // Defaults to the creator when left out.
    ownerUserId: fields.ownerUserId.optional(),
    startDate: fields.startDate.optional(),
    endDate: fields.endDate.optional(),
    description: fields.description.optional(),
  })
  .strict()
  .refine((p) => datesInOrder(p.startDate, p.endDate), {
    message: DATE_ORDER_MESSAGE,
    path: ['endDate'],
  });
export type CreateProjectRequest = z.input<typeof createProjectRequestSchema>;
export type CreateProjectInput = z.infer<typeof createProjectRequestSchema>;

/** The code is the project's identity and cannot change. Status changes have their own request. */
export const updateProjectRequestSchema = z
  .object({
    name: fields.name.optional(),
    ownerUserId: fields.ownerUserId.optional(),
    startDate: fields.startDate.optional(),
    endDate: fields.endDate.optional(),
    description: fields.description.optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'Nothing to update')
  .refine((p) => datesInOrder(p.startDate, p.endDate), {
    message: DATE_ORDER_MESSAGE,
    path: ['endDate'],
  });
export type UpdateProjectRequest = z.input<typeof updateProjectRequestSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectRequestSchema>;
export { DATE_ORDER_MESSAGE };

export const changeProjectStatusRequestSchema = z.object({ status: projectStatusSchema }).strict();

export const PROJECT_SORTS = ['code', 'name', 'status', 'start', 'end'] as const;
export const listProjectsQuerySchema = listQuerySchema(PROJECT_SORTS, {
  status: projectStatusSchema.optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const projectIdParamsSchema = z.object({ projectId: z.string().uuid() });
export const projectMemberParamsSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
});
export const userLookupQuerySchema = z
  .object({ search: z.string().trim().max(100).optional() })
  .strict();

export type ProjectSummary = {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  ownerName: string;
  startDate: string | null;
  endDate: string | null;
};
export type ProjectPage = Page<ProjectSummary>;

export type ProjectDetail = ProjectSummary & {
  ownerUserId: string;
  description: string | null;
  /** Statuses this project may move to next, decided by the server. */
  nextStatuses: ProjectStatus[];
  createdAt: string;
  updatedAt: string;
};

export type UserRef = { id: string; name: string; email: string };

export type ProjectMember = UserRef & {
  isOwner: boolean;
  /** False for administrators, who belong to every project without a membership row (D17). */
  removable: boolean;
};
