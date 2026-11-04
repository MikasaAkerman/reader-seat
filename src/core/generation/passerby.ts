import { z } from 'zod'
import type { LlmClient, LlmUsage } from '../llm'
import { buildPasserbyPrompt, type PasserbyPromptContext } from '../prompts/passerby'

export const passerbyBatchSchema = z.object({
  comments: z
    .array(
      z.object({
        display_name: z.string().default('路人'),
        text: z.string(),
        uses_outside_plot: z.boolean().default(false),
      }),
    )
    .default([]),
})

export type PasserbyBatch = z.infer<typeof passerbyBatchSchema>

export async function runPasserbyBatch(
  ctx: PasserbyPromptContext,
  client: LlmClient,
  signal?: AbortSignal,
): Promise<PasserbyBatch & { usage: LlmUsage }> {
  const { data, usage } = await client.chatJson(buildPasserbyPrompt(ctx), passerbyBatchSchema, {
    temperature: 1.3,
    maxTokens: 800,
    timeoutMs: 60_000,
    signal,
  })
  return {
    comments: data.comments.filter((comment) => comment.text.trim() && !comment.uses_outside_plot),
    usage,
  }
}
