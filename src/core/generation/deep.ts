import type { LlmClient, LlmUsage, ReasoningMode } from '../llm'
import { buildDeepPlanPrompt, buildDeepPrompt, type DeepPlanPromptContext, type DeepPromptContext } from '../prompts'
import { emptyDropped, gateComment, type DroppedCounts } from '../quality'
import { verifyQuote } from '../quality/quote'
import type { TextBlock } from '../types'
import { deepPlanSchema, deepResultSchema, pidToIndex, type DeepPlan, type DeepResult } from './schema'

export async function runDeepPlan(
  ctx: DeepPlanPromptContext,
  client: LlmClient,
  signal?: AbortSignal,
): Promise<DeepPlan & { usage: LlmUsage }> {
  const { data, usage } = await client.chatJson(buildDeepPlanPrompt(ctx), deepPlanSchema, {
    maxTokens: 800,
    timeoutMs: 60_000,
    reasoning: 'off',
    signal,
  })
  return { ...data, spots: data.spots.slice(0, Math.max(0, ctx.maxSpots)), usage }
}

function evidenceOk(result: DeepResult, block: TextBlock, upTo: number): boolean {
  const quotes = result.thesis.evidence ?? []
  const passed = quotes.filter((item) => {
    const index = (() => {
      try {
        return Math.min(pidToIndex(item.pid), upTo)
      } catch {
        return upTo
      }
    })()
    return verifyQuote(item.quote, block.paragraphs, index)
  })
  return passed.length >= 2
}

export async function runDeep(
  ctx: DeepPromptContext,
  block: TextBlock,
  client: LlmClient,
  knownEntities: Set<string>,
  newEntities: string[],
  signal?: AbortSignal,
  reasoning: ReasoningMode = 'high',
): Promise<{ result: DeepResult | null; usage: LlmUsage; dropped: DroppedCounts }> {
  const dropped = emptyDropped()
  const { data, usage } = await client.chatJson(buildDeepPrompt(ctx), deepResultSchema, {
    maxTokens: 8000,
    timeoutMs: 240_000,
    reasoning,
    signal,
  })
  const upTo = block.paragraphs.length
  if (!data.thesis.body.trim() || !evidenceOk(data, block, upTo)) {
    dropped.quote += 1
    return { result: null, usage, dropped }
  }
  const texts = [data.thesis.body, data.rebuttal?.body ?? '', data.background]
  for (const text of texts) {
    if (!text.trim()) continue
    const quote = data.thesis.evidence[0]?.quote || ''
    const gate = gateComment({
      text,
      quote,
      paragraphIndex: upTo,
      block,
      knownEntities,
      newEntities,
      usesOutsidePlot: false,
      corpus: [],
      extras: data.thesis.evidence.map((item) => item.quote),
    })
    if (!gate.ok && gate.reason !== 'quote') {
      dropped[gate.reason] += 1
      return { result: null, usage, dropped }
    }
  }
  return { result: data, usage, dropped }
}
