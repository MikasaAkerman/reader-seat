import type { ChatMessage } from '../llm/types'
import { PROMPT_VERSION, SHARED_CONSTRAINTS } from './constraints'

export interface ChapterTalkPromptContext {
  title: string
  spoilerLevel: string
  memorySnapshot: string
  chapterTitle: string
  readText: string
}

export function buildChapterTalkPrompt(ctx: ChapterTalkPromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        SHARED_CONSTRAINTS,
        '本任务是章末整理和本章说。只根据下面已经读过的正文写，不预告后文。',
        'summary 一两百字。hot_paragraphs 写 2 到 3 个最值得回看的段落编号，例如 p3。',
        'resident_lines 是每位出场常驻书友对本章的一句话，口吻要像这个人。',
        'debates 是本章主要分歧，summary 用一句话写清各方立场。',
        'prediction_updates 只写已经能从正文判断应验或打脸的旧预测，status 用「应验」或「打脸」。',
        'memory_updates 只收录正文里已经出现的外号、预测、争议、名场面和站队。四个数组和 scenes、resident_stance_changes 都要在，没有就给空数组。',
        `提示词版本：${PROMPT_VERSION}`,
        '只返回一个 json 对象。没有的数组给空数组。',
      ].join('\n'),
    },
    { role: 'user', content: `书圈记忆\n${ctx.memorySnapshot || '（空）'}` },
    {
      role: 'user',
      content: `书名：${ctx.title}\n防剧透：${ctx.spoilerLevel}\n章节：${ctx.chapterTitle}\n\n已读正文\n${ctx.readText}`,
    },
  ]
}
