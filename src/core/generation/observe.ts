import type { LlmClient, LlmUsage } from '../llm'
import { buildObservePrompt, type ObservePromptContext } from '../prompts'
import { observeResultSchema, type ObserveResult } from './schema'

export function observeMaxTokens(pickCount: number): number {
  return Math.min(1200, 400 + 80 * Math.max(1, pickCount))
}

export async function runObserve(
  ctx: ObservePromptContext,
  client: LlmClient,
  signal?: AbortSignal,
): Promise<ObserveResult & { usage: LlmUsage }> {
  const { data, usage } = await client.chatJson(buildObservePrompt(ctx), observeResultSchema, {
    maxTokens: observeMaxTokens(ctx.maxPicks),
    timeoutMs: 60_000,
    reasoning: 'off',
    signal,
  })
  return { ...data, usage }
}
