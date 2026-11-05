import type { LlmClient, LlmUsage } from '../llm'
import { buildRefinePrompt, type RefinePromptContext } from '../prompts'
import { emptyDropped, extractQuoted, gateComment, type DroppedCounts } from '../quality'
import type { TextBlock } from '../types'
import { pidToIndex, refineResultSchema, type RefineComment, type RefineResult } from './schema'

function keepComment(
  comment: RefineComment,
  paragraphIndex: number,
  block: TextBlock,
  knownEntities: Set<string>,
  newEntities: string[],
  corpus: string[],
  extras: string[],
): { ok: true } | { ok: false; reason: keyof DroppedCounts } {
  const quote = comment.quote?.trim() || extractQuoted(comment.text)[0] || extras.find((item) => item.length >= 4) || ''
  return gateComment({
    text: comment.text,
    quote,
    paragraphIndex,
    block,
    knownEntities,
    newEntities,
    usesOutsidePlot: comment.uses_outside_plot,
    corpus,
    extras,
  })
}

export async function runRefine(
  ctx: RefinePromptContext,
  block: TextBlock,
  client: LlmClient,
  knownEntities: Set<string>,
  newEntities: string[],
  extras: string[] = [],
  corpus: string[] = [],
  signal?: AbortSignal,
): Promise<RefineResult & { usage: LlmUsage; dropped: DroppedCounts }> {
  const { data, usage } = await client.chatJson(buildRefinePrompt(ctx), refineResultSchema, {
    temperature: 0.8,
    maxTokens: 2000,
    timeoutMs: 60_000,
    reasoning: 'off',
    signal,
  })
  const index = pidToIndex(data.pid)
  const dropped = emptyDropped()
  const seen = [...corpus]
  const threads = data.threads.flatMap((thread) => {
    const rootGate = keepComment(thread.root, index, block, knownEntities, newEntities, seen, extras)
    if (!rootGate.ok) {
      dropped[rootGate.reason] += 1
      return []
    }
    seen.push(thread.root.text)
    const replies = thread.replies.filter((reply) => {
      const gate = keepComment(reply, index, block, knownEntities, newEntities, seen, extras)
      if (!gate.ok) {
        dropped[gate.reason] += 1
        return false
      }
      seen.push(reply.text)
      return true
    })
    return [{ root: thread.root, replies }]
  })
  return { ...data, threads, usage, dropped }
}
