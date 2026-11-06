import type { LlmClient, LlmUsage } from '../llm'
import { buildBackgroundPrompt, type BackgroundPromptContext } from '../prompts'
import { emptyDropped, type DroppedCounts } from '../quality'
import type { TextBlock } from '../types'
import { backgroundResultSchema, type BackgroundResult } from './schema'
import { filterByEntityRule } from './entities'
import { verifyQuote } from '../quality/quote'

export async function runBackground(
  ctx: BackgroundPromptContext,
  block: TextBlock,
  client: LlmClient,
  knownEntities: Set<string>,
  laterNames: string[],
  signal?: AbortSignal,
): Promise<{ result: BackgroundResult | null; usage: LlmUsage; dropped: DroppedCounts }> {
  const dropped = emptyDropped()
  const { data, usage } = await client.chatJson(buildBackgroundPrompt(ctx), backgroundResultSchema, {
    maxTokens: 400,
    timeoutMs: 45_000,
    reasoning: 'off',
    signal,
  })
  if (!data.text.trim()) return { result: null, usage, dropped }
  if (data.uses_outside_plot) {
    dropped.outside += 1
    return { result: null, usage, dropped }
  }
  const index = block.paragraphs.length
  if (!verifyQuote(data.quote, block.paragraphs, index)) {
    dropped.quote += 1
    return { result: null, usage, dropped }
  }
  const kept = filterByEntityRule(
    [{ paragraphIndex: index, text: data.text }],
    block,
    knownEntities,
    laterNames,
  )
  if (kept.length !== 1) {
    dropped.entity += 1
    return { result: null, usage, dropped }
  }
  return { result: data, usage, dropped }
}
