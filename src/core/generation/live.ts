import { z } from 'zod'
import type { LlmClient, LlmUsage } from '../llm'
import { buildDialoguePrompt, buildLivePrompt, type DialoguePromptContext, type LivePromptContext } from '../prompts'
import { isNearDuplicate } from '../quality'
import type { TextBlock } from '../types'
import { filterByEntityRule } from './entities'
import { liveReplySchema, type LiveReply } from './schema'

const dialogueSchema = z.object({
  text: z.string().default(''),
  uses_outside_plot: z.boolean().default(false),
})

export async function runDialogue(
  ctx: DialoguePromptContext,
  client: LlmClient,
  block: TextBlock,
  knownEntities: Set<string>,
  signal?: AbortSignal,
  laterNames: string[] = [],
): Promise<{ text: string | null; usage: LlmUsage }> {
  const { data, usage } = await client.chatJson(buildDialoguePrompt(ctx), dialogueSchema, {
    maxTokens: 4000,
    timeoutMs: 90_000,
    reasoning: 'high',
    signal,
  })
  const text = data.text.trim()
  if (!text || data.uses_outside_plot) return { text: null, usage }
  const kept = filterByEntityRule(
    [{ paragraphIndex: block.paragraphs.length, text }],
    block,
    knownEntities,
    laterNames,
  )
  return { text: kept.length === 1 ? text : null, usage }
}

/** laterNames：本章后面才出现的名字，接话时不许提。 */
export async function runLiveReply(
  ctx: LivePromptContext,
  client: LlmClient,
  block: TextBlock,
  knownEntities: Set<string>,
  onReply: (reply: LiveReply) => void,
  signal?: AbortSignal,
  laterNames: string[] = [],
  corpus: string[] = [],
): Promise<{ usage: LlmUsage }> {
  const paragraphIndex = block.paragraphs.length
  const seen = [...corpus]
  return {
    usage: await client.chatJsonl(
      buildLivePrompt(ctx),
      liveReplySchema,
      (reply) => {
        if (reply.uses_outside_plot || !reply.text.trim()) return
        if (isNearDuplicate(reply.text, seen)) return
        const kept = filterByEntityRule(
          [{ paragraphIndex, text: reply.text }],
          block,
          knownEntities,
          laterNames,
        )
        if (kept.length !== 1) return
        seen.push(reply.text)
        onReply(reply)
      },
      { maxTokens: 2000, reasoning: 'off', signal },
    ),
  }
}
