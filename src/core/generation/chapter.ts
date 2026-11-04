import type { LlmClient, LlmUsage } from '../llm'
import { buildChapterTalkPrompt, type ChapterTalkPromptContext } from '../prompts'
import { chapterTalkResultSchema, type ChapterTalkResult } from './schema'

export async function runChapterTalk(
  ctx: ChapterTalkPromptContext,
  client: LlmClient,
  signal?: AbortSignal,
): Promise<ChapterTalkResult & { usage: LlmUsage }> {
  const { data, usage } = await client.chatJson(buildChapterTalkPrompt(ctx), chapterTalkResultSchema, {
    temperature: 1,
    maxTokens: 2000,
    timeoutMs: 60_000,
    signal,
  })
  return { ...data, usage }
}
