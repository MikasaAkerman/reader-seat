import type { LlmClient, LlmUsage } from '../llm'
import { buildLivePrompt, type LivePromptContext } from '../prompts'
import type { TextBlock } from '../types'
import { filterByEntityRule } from './entities'
import { liveReplySchema, type LiveReply } from './schema'

/** laterNames：本章后面才出现的名字，接话时不许提。 */
export async function runLiveReply(
  ctx: LivePromptContext,
  client: LlmClient,
  block: TextBlock,
  knownEntities: Set<string>,
  onReply: (reply: LiveReply) => void,
  signal?: AbortSignal,
  laterNames: string[] = [],
): Promise<{ usage: LlmUsage }> {
  const paragraphIndex = block.paragraphs.length
  return {
    usage: await client.chatJsonl(
      buildLivePrompt(ctx),
      liveReplySchema,
      (reply) => {
        if (reply.uses_outside_plot || !reply.text.trim()) return
        const kept = filterByEntityRule(
          [{ paragraphIndex, text: reply.text }],
          block,
          knownEntities,
          laterNames,
        )
        if (kept.length === 1) onReply(reply)
      },
      { temperature: 1.3, maxTokens: 600, reasoning: 'off', signal },
    ),
  }
}
