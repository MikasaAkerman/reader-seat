import { z } from 'zod'
import type { LlmClient, LlmUsage } from '../llm'
import { buildSpoilerPrompt, type SpoilerPromptContext } from '../prompts/spoiler'

export const spoilerCheckSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        pass: z.boolean().default(true),
      }),
    )
    .default([]),
})

export type SpoilerCheck = z.infer<typeof spoilerCheckSchema>

export function commentPasses(id: string, results: { id: string; pass: boolean }[]): boolean {
  const found = results.find((item) => item.id === id)
  return found ? found.pass : true
}

export async function runSpoilerCheck(
  ctx: SpoilerPromptContext,
  client: LlmClient,
  signal?: AbortSignal,
): Promise<SpoilerCheck & { usage: LlmUsage }> {
  const { data, usage } = await client.chatJson(buildSpoilerPrompt(ctx), spoilerCheckSchema, {
    temperature: 0,
    maxTokens: 800,
    timeoutMs: 30_000,
    signal,
  })
  return { ...data, usage }
}
