import { z } from 'zod'

const scoreSchema = z
  .union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal('0'),
    z.literal('1'),
    z.literal('2'),
    z.literal('3'),
  ])
  .transform((value) => Number(value) as 0 | 1 | 2 | 3)

export const roughCommentSchema = z.object({
  author_type: z.enum(['resident', 'passerby']),
  reader_role: z.string().optional(),
  display_name: z.string().optional(),
  sampled_dims: z.array(z.string()).optional(),
  text: z.string(),
  reaction_type: z.string().default(''),
  stance: z.string().default(''),
  uses_outside_plot: z.boolean().default(false),
})

export const predictionHitSchema = z.object({
  prediction_id: z.string(),
  result: z.string(),
})

export const roughParagraphSchema = z.object({
  pid: z.string(),
  score: scoreSchema,
  comments: z.array(roughCommentSchema).default([]),
  background_note: z.string().nullable().optional(),
  prediction_hits: z.array(predictionHitSchema).default([]),
})

export const roughResultSchema = z.object({
  paragraphs: z.array(roughParagraphSchema),
  new_entities: z.array(z.string()).default([]),
})

export const refineCommentSchema = z.object({
  author_type: z.enum(['resident', 'passerby']),
  reader_role: z.string().optional(),
  display_name: z.string().optional(),
  text: z.string(),
  uses_outside_plot: z.boolean().default(false),
  reply_type: z.string().optional(),
})

export const refineThreadSchema = z.object({
  root: refineCommentSchema,
  replies: z.array(refineCommentSchema).default([]),
})

export const memoryUpdatesSchema = z.object({
  nicknames: z
    .array(
      z.object({
        character: z.string(),
        nickname: z.string(),
        by: z.string(),
      }),
    )
    .default([]),
  predictions: z
    .array(
      z.object({
        by: z.string(),
        content: z.string(),
      }),
    )
    .default([]),
  debates: z
    .array(
      z.object({
        topic: z.string(),
        sides: z.record(z.string(), z.string()),
      }),
    )
    .default([]),
  resident_stance_changes: z.array(z.unknown()).default([]),
})

export const refineResultSchema = z.object({
  pid: z.string(),
  threads: z.array(refineThreadSchema),
  memory_updates: memoryUpdatesSchema.default({
    nicknames: [],
    predictions: [],
    debates: [],
    resident_stance_changes: [],
  }),
})

export type RoughComment = z.infer<typeof roughCommentSchema>
export type RoughParagraph = z.infer<typeof roughParagraphSchema>
export type RoughResult = z.infer<typeof roughResultSchema>
export type RefineComment = z.infer<typeof refineCommentSchema>
export type RefineThread = z.infer<typeof refineThreadSchema>
export type MemoryUpdates = z.infer<typeof memoryUpdatesSchema>
export type RefineResult = z.infer<typeof refineResultSchema>

export function pidToIndex(pid: string): number {
  const n = Number(pid.replace(/^p/i, ''))
  if (!Number.isInteger(n) || n < 1) throw new Error(`非法段落编号: ${pid}`)
  return n
}
