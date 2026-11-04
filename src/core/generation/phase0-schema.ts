import { z } from 'zod'

const replySchema = z.object({
  id: z.string(),
  authorType: z.enum(['resident', 'passerby']),
  displayName: z.string(),
  text: z.string(),
  replyType: z.string().optional(),
})

const commentSchema = z.object({
  id: z.string(),
  authorType: z.enum(['resident', 'passerby']),
  displayName: z.string(),
  text: z.string(),
  replies: z.array(replySchema),
})

export const phase0DocumentSchema = z.object({
  promptVersion: z.number(),
  title: z.string(),
  paragraphs: z.array(
    z.object({
      index: z.number(),
      text: z.string(),
      score: z.number(),
      comments: z.array(commentSchema),
    }),
  ),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    cacheHitTokens: z.number(),
    reasoningTokens: z.number().default(0),
  }),
  cost: z.number(),
})
