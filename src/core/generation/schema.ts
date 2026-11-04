import { z } from 'zod'

const authorTypeSchema = z
  .unknown()
  .transform((value) => (value === 'resident' ? 'resident' : 'passerby') as 'resident' | 'passerby')

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
  author_type: authorTypeSchema,
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
  background_note: z
    .unknown()
    .optional()
    .transform((value) => (typeof value === 'string' ? value : null)),
  prediction_hits: z.array(predictionHitSchema).default([]),
})

export const roughResultSchema = z.object({
  paragraphs: z.array(roughParagraphSchema),
  new_entities: z.array(z.string()).default([]),
})

export const refineCommentSchema = z.object({
  author_type: authorTypeSchema,
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
  scenes: z
    .array(
      z.object({
        label: z.string(),
        chapterOrder: z.number().optional(),
      }),
    )
    .default([]),
})

export const refineResultSchema = z.object({
  pid: z.string(),
  threads: z.array(refineThreadSchema),
  memory_updates: memoryUpdatesSchema.default({
    nicknames: [],
    predictions: [],
    debates: [],
    resident_stance_changes: [],
    scenes: [],
  }),
})

export type RoughComment = z.infer<typeof roughCommentSchema>
export type RoughParagraph = z.infer<typeof roughParagraphSchema>
export type RoughResult = z.infer<typeof roughResultSchema>
export type RefineComment = z.infer<typeof refineCommentSchema>
export type RefineThread = z.infer<typeof refineThreadSchema>
export type MemoryUpdates = z.infer<typeof memoryUpdatesSchema>
export type RefineResult = z.infer<typeof refineResultSchema>

export const liveReplySchema = z.object({
  author_type: authorTypeSchema,
  reader_role: z.string().optional(),
  display_name: z.string().optional(),
  text: z.string(),
  uses_outside_plot: z.boolean().default(false),
})

function emptyMemoryUpdates() {
  return {
    nicknames: [],
    predictions: [],
    debates: [],
    resident_stance_changes: [],
    scenes: [],
  }
}

function keepStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function keepObjects<T>(value: unknown, item: z.ZodType<T>): T[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const parsed = item.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

const residentLineSchema = z.object({
  reader_role: z.string().default(''),
  text: z.string().default(''),
})

const debateSchema = z.object({
  topic: z.string().default(''),
  summary: z.string().default(''),
})

const predictionUpdateSchema = z.object({
  prediction_id: z.string().default(''),
  status: z.string().default(''),
})

export const chapterTalkResultSchema = z.object({
  summary: z.string().default(''),
  hot_paragraphs: z.preprocess(keepStrings, z.array(z.string())),
  resident_lines: z.preprocess((value) => keepObjects(value, residentLineSchema), z.array(residentLineSchema)),
  debates: z.preprocess((value) => keepObjects(value, debateSchema), z.array(debateSchema)),
  prediction_updates: z.preprocess(
    (value) => keepObjects(value, predictionUpdateSchema),
    z.array(predictionUpdateSchema),
  ),
  memory_updates: memoryUpdatesSchema.catch(emptyMemoryUpdates()),
})

export type LiveReply = z.infer<typeof liveReplySchema>
export type ChapterTalkResult = z.infer<typeof chapterTalkResultSchema>

export function pidToIndex(pid: string): number {
  const n = Number(pid.replace(/^p/i, ''))
  if (!Number.isInteger(n) || n < 1) throw new Error(`非法段落编号: ${pid}`)
  return n
}
