import type { LlmClient, LlmUsage } from '../llm'
import { buildBackgroundPrompt, type BackgroundPromptContext } from '../prompts'
import { emptyDropped, type DroppedCounts } from '../quality'
import type { TextBlock } from '../types'
import { backgroundResultSchema, type BackgroundResult } from './schema'
import { filterByEntityRule } from './entities'
import { verifyQuote } from '../quality/quote'

function plusUsage(left: LlmUsage, right: LlmUsage): LlmUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    cacheHitTokens: left.cacheHitTokens + right.cacheHitTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  }
}

export async function runBackground(
  ctx: BackgroundPromptContext,
  block: TextBlock,
  client: LlmClient,
  knownEntities: Set<string>,
  laterNames: string[],
  signal?: AbortSignal,
): Promise<{ result: BackgroundResult | null; usage: LlmUsage; dropped: DroppedCounts }> {
  const dropped = emptyDropped()
  const index = block.paragraphs.length
  const quoteOk = (quote: string) => verifyQuote(quote, block.paragraphs, index)
  const ask = (quoteRetry: boolean) =>
    client.chatJson(buildBackgroundPrompt({ ...ctx, quoteRetry }), backgroundResultSchema, {
      maxTokens: 1500,
      timeoutMs: 45_000,
      reasoning: 'off',
      signal,
    })

  const first = await ask(false)
  let usage = first.usage
  let data = first.data
  if (!quoteOk(data.quote)) {
    const second = await ask(true)
    usage = plusUsage(usage, second.usage)
    if (second.data.text.trim()) data = second.data
  }
  if (!data.text.trim()) return { result: null, usage, dropped }
  if (!quoteOk(data.quote)) data = { ...data, quote: '' }
  const kept = filterByEntityRule([{ paragraphIndex: index, text: data.text }], block, knownEntities, laterNames)
  if (kept.length !== 1) {
    dropped.entity += 1
    return { result: null, usage, dropped }
  }
  return { result: data, usage, dropped }
}
