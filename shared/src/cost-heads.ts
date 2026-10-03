import { z } from 'zod';

/** Administration > Cost Heads. The heads themselves are data (seed file, admin screen), never code. */

/** Letters and digits, with spaces, dots, dashes, underscores or slashes between: "03", "03 30 00", "C-12". */
export const costHeadCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9 ._/-]*[A-Za-z0-9])?$/,
    'Use letters, digits, spaces and . _ / -',
  );

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000).nullable();

export const createCostHeadRequestSchema = z
  .object({
    code: costHeadCodeSchema,
    name,
    description: description.optional(),
  })
  .strict();
export type CreateCostHeadRequest = z.input<typeof createCostHeadRequestSchema>;
export type CreateCostHeadInput = z.infer<typeof createCostHeadRequestSchema>;

/** Code and name can be corrected; `active: false` deactivates. There is no delete (D18). */
export const updateCostHeadRequestSchema = z
  .object({
    code: costHeadCodeSchema.optional(),
    name: name.optional(),
    description: description.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'Nothing to update');
export type UpdateCostHeadRequest = z.input<typeof updateCostHeadRequestSchema>;
export type UpdateCostHeadInput = z.infer<typeof updateCostHeadRequestSchema>;

export const COST_HEADS_MAX = 500;

/** The complete new order: every live head (active or not) exactly once, first to last. */
export const reorderCostHeadsRequestSchema = z
  .object({
    ids: z
      .array(z.string().uuid())
      .min(1)
      .max(COST_HEADS_MAX)
      .refine((ids) => new Set(ids).size === ids.length, 'Each head may appear once'),
  })
  .strict();
export type ReorderCostHeadsRequest = z.infer<typeof reorderCostHeadsRequestSchema>;

export const costHeadIdParamsSchema = z.object({ costHeadId: z.string().uuid() });

export type CostHead = {
  id: string;
  /** System number, C001...: assigned by the server, never sent by a client. */
  systemNo: string;
  code: string;
  name: string;
  description: string | null;
  displayOrder: number;
  active: boolean;
};
