import type { LlmClient } from '../llm'
import { buildRoughPrompt, type RoughPromptContext } from '../prompts'
import type { TextBlock } from '../types'
import { filterByEntityRule } from './entities'
import { pidToIndex, roughResultSchema, type RoughResult } from './schema'

export async function runRough(
  ctx: RoughPromptContext,
  block: TextBlock,
  client: LlmClient,
  knownEntities: Set<string>,
): Promise<RoughResult> {
  const { data } = await client.chatJson(buildRoughPrompt(ctx), roughResultSchema, {
    temperature: 1,
    maxTokens: 2000,
    timeoutMs: 60_000,
  })

  const paragraphs = data.paragraphs.map((paragraph) => {
    const index = pidToIndex(paragraph.pid)
    const visible = paragraph.score === 3 ? [] : paragraph.comments.filter((c) => !c.uses_outside_plot)
    const kept = filterByEntityRule(
      visible.map((c) => ({ paragraphIndex: index, text: c.text })),
      { paragraphs: block.paragraphs },
      knownEntities,
      data.new_entities,
    )
    const keptText = new Set(kept.map((c) => c.text))
    return {
      ...paragraph,
      comments: visible.filter((c) => keptText.has(c.text)),
    }
  })

  return { paragraphs, new_entities: data.new_entities }
}
