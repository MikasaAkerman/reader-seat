import type { LlmClient, LlmUsage } from '../llm'
import { buildRoughPrompt, type RoughPromptContext } from '../prompts'
import type { TextBlock } from '../types'
import { filterByEntityRule } from './entities'
import { pidToIndex, roughLineSchema, roughResultSchema, type RoughParagraph, type RoughResult } from './schema'

/** 每段的分数、评论和字段开销大约 160 token，再留一点给 new_entities。 */
export function roughMaxTokens(paragraphCount: number): number {
  return Math.min(4000, 300 + 160 * Math.max(1, paragraphCount))
}

function safeIndex(pid: string): number | null {
  try {
    return pidToIndex(pid)
  } catch {
    return null
  }
}

/** 去掉自报用了外部情节的评论，再按实体首次出现规则过滤。 */
export function cleanRoughParagraph(
  paragraph: RoughParagraph,
  block: TextBlock,
  knownEntities: Set<string>,
  newEntities: string[],
): RoughParagraph {
  const index = safeIndex(paragraph.pid)
  if (index === null) return { ...paragraph, comments: [] }
  const visible = paragraph.comments.filter((c) => !c.uses_outside_plot)
  const kept = filterByEntityRule(
    visible.map((c) => ({ paragraphIndex: index, text: c.text })),
    { paragraphs: block.paragraphs },
    knownEntities,
    newEntities,
  )
  const keptText = new Set(kept.map((c) => c.text))
  return { ...paragraph, comments: visible.filter((c) => keptText.has(c.text)) }
}

export async function runRough(
  ctx: RoughPromptContext,
  block: TextBlock,
  client: LlmClient,
  knownEntities: Set<string>,
  signal?: AbortSignal,
): Promise<RoughResult & { usage: LlmUsage }> {
  const { data, usage } = await client.chatJson(buildRoughPrompt(ctx), roughResultSchema, {
    temperature: 1,
    maxTokens: roughMaxTokens(block.paragraphs.length),
    timeoutMs: 90_000,
    reasoning: 'off',
    signal,
  })
  const paragraphs = data.paragraphs.map((paragraph) =>
    cleanRoughParagraph(paragraph, block, knownEntities, data.new_entities),
  )
  return { paragraphs, new_entities: data.new_entities, usage }
}

/**
 * 逐段流式粗评。每收到一段就交给 onParagraph，这时只知道到这一段为止的新实体；
 * 全部收完后按完整实体表再过滤一次，返回最终结果，调用方据此修正已经落库的段。
 * 模型不按行输出、一段都没收到时，退回一次性 JSON。
 */
export async function runRoughStream(
  ctx: RoughPromptContext,
  block: TextBlock,
  client: LlmClient,
  knownEntities: Set<string>,
  onParagraph: (paragraph: RoughParagraph) => void,
  signal?: AbortSignal,
): Promise<RoughResult & { usage: LlmUsage; streamed: boolean }> {
  const received = new Map<string, RoughParagraph>()
  const newEntities: string[] = []
  const usage = await client.chatJsonl(
    buildRoughPrompt(ctx, 'jsonl'),
    roughLineSchema,
    (line) => {
      for (const name of line.new_entities) if (!newEntities.includes(name)) newEntities.push(name)
      if (received.has(line.pid) || safeIndex(line.pid) === null) return
      const paragraph: RoughParagraph = {
        pid: line.pid,
        score: line.score,
        comments: line.comments,
        background_note: line.background_note,
        prediction_hits: line.prediction_hits,
      }
      received.set(line.pid, paragraph)
      onParagraph(cleanRoughParagraph(paragraph, block, knownEntities, newEntities))
    },
    {
      temperature: 1,
      maxTokens: roughMaxTokens(block.paragraphs.length),
      timeoutMs: 90_000,
      firstItemMs: 30_000,
      reasoning: 'off',
      signal,
    },
  )
  if (received.size === 0) {
    const fallback = await runRough(ctx, block, client, knownEntities, signal)
    for (const paragraph of fallback.paragraphs) onParagraph(paragraph)
    return {
      ...fallback,
      usage: {
        promptTokens: usage.promptTokens + fallback.usage.promptTokens,
        completionTokens: usage.completionTokens + fallback.usage.completionTokens,
        cacheHitTokens: usage.cacheHitTokens + fallback.usage.cacheHitTokens,
        reasoningTokens: usage.reasoningTokens + fallback.usage.reasoningTokens,
      },
      streamed: false,
    }
  }
  const paragraphs = [...received.values()].map((paragraph) =>
    cleanRoughParagraph(paragraph, block, knownEntities, newEntities),
  )
  return { paragraphs, new_entities: newEntities, usage, streamed: true }
}
