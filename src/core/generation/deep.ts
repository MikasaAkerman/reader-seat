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

function plusUsage(left: LlmUsage, right: LlmUsage): LlmUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    cacheHitTokens: left.cacheHitTokens + right.cacheHitTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  }
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
  const upTo = block.paragraphs.length
  const ask = () =>
    client.chatJson(buildDeepPrompt(ctx), deepResultSchema, {
      maxTokens: 16000,
      timeoutMs: 240_000,
      reasoning,
      signal,
    })
  const first = await ask()
  let usage = first.usage
  let data = first.data
  if (!data.thesis.body.trim() || !evidenceOk(data, block, upTo)) {
    const second = await ask()
    usage = plusUsage(usage, second.usage)
    data = second.data
  }
  if (!data.thesis.body.trim() || !evidenceOk(data, block, upTo)) {
    dropped.quote += 1
    return { result: null, usage, dropped }
  }
  const extras = data.thesis.evidence.map((item) => item.quote)
  const quote = extras[0] || ''
  for (const text of [data.thesis.body, data.rebuttal?.body ?? '']) {
    if (!text.trim()) continue
    const gate = gateComment({
      text,
      quote,
      paragraphIndex: upTo,
      block,
      knownEntities,
      newEntities,
      usesOutsidePlot: false,
      corpus: [],
      extras,
    })
    if (!gate.ok && gate.reason !== 'quote') {
      dropped[gate.reason] += 1
      return { result: null, usage, dropped }
    }
  }
  if (data.background.trim()) {
    const gate = gateComment({
      text: data.background,
      quote,
      paragraphIndex: upTo,
      block,
      knownEntities,
      newEntities,
      usesOutsidePlot: false,
      corpus: [],
      extras,
    })
    if (!gate.ok) data = { ...data, background: '' }
  }
  return { result: data, usage, dropped }
}
