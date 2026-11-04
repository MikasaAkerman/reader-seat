import type { LlmClient, LlmUsage } from '../llm'
import { buildRefinePrompt, type RefinePromptContext } from '../prompts'
import type { TextBlock } from '../types'
import { filterByEntityRule } from './entities'
import { pidToIndex, refineResultSchema, type RefineComment, type RefineResult } from './schema'

function keepComment(
  comment: RefineComment,
  paragraphIndex: number,
  block: TextBlock,
  knownEntities: Set<string>,
  newEntities: string[],
): boolean {
  if (comment.uses_outside_plot) return false
  const kept = filterByEntityRule(
    [{ paragraphIndex, text: comment.text }],
    { paragraphs: block.paragraphs },
    knownEntities,
    newEntities,
  )
  return kept.length === 1
}

export async function runRefine(
  ctx: RefinePromptContext,
  block: TextBlock,
  client: LlmClient,
  knownEntities: Set<string>,
  newEntities: string[],
  signal?: AbortSignal,
): Promise<RefineResult & { usage: LlmUsage }> {
  const { data, usage } = await client.chatJson(buildRefinePrompt(ctx), refineResultSchema, {
    temperature: 1.3,
    maxTokens: 2000,
    timeoutMs: 60_000,
    reasoning: 'off',
    signal,
  })
  const index = pidToIndex(data.pid)
  const threads = data.threads
    .filter((thread) => keepComment(thread.root, index, block, knownEntities, newEntities))
    .map((thread) => ({
      root: thread.root,
      replies: thread.replies.filter((reply) =>
        keepComment(reply, index, block, knownEntities, newEntities),
      ),
    }))
  return { ...data, threads, usage }
}
