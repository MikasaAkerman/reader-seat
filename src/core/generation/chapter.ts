import type { LlmClient, LlmUsage, ReasoningMode } from '../llm'
import { buildChapterTalkPrompt, type ChapterTalkPromptContext } from '../prompts'
import { chapterTalkResultSchema, type ChapterTalkResult } from './schema'

export async function runChapterTalk(
  ctx: ChapterTalkPromptContext,
  client: LlmClient,
  signal?: AbortSignal,
  reasoning: ReasoningMode = 'low',
): Promise<ChapterTalkResult & { usage: LlmUsage }> {
  const { data, usage } = await client.chatJson(buildChapterTalkPrompt(ctx), chapterTalkResultSchema, {
    maxTokens: reasoning === 'low' ? 3000 : 2000,
    timeoutMs: 120_000,
    reasoning,
    signal,
  })
  return { ...data, usage }
}
