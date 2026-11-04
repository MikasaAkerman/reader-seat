import type { ChatMessage } from '../llm/types'
import { PROMPT_VERSION, SHARED_CONSTRAINTS } from './constraints'
import { bookInfo } from './rough'

export interface LiveReplierPrompt {
  role: string
  displayName: string
  voice: string
}

export interface LivePromptContext {
  title: string
  spoilerLevel: string
  memorySnapshot: string
  priorSummary: string
  /** 本章已读到的文本，超长时只取末尾一截 */
  textUntilHere: string
  userText: string
  parentText?: string
  repliers: LiveReplierPrompt[]
}

export function buildLivePrompt(ctx: LivePromptContext): ChatMessage[] {
  const who = ctx.repliers
    .map((person) => `${person.role}（${person.displayName}）口吻：${person.voice || '口语'}`)
    .join('\n')
  return [
    {
      role: 'system',
      content: [
        SHARED_CONSTRAINTS,
        '本任务是接话。只回应读者刚刚写的那句，不要重写段评，不要总结全文。',
        '每位被点名的书友各写一行，一行一个 json 对象，不要包在数组里，不要换行排版。',
        '每条都要有 author_type、reader_role、display_name、text、uses_outside_plot。author_type 只能是 resident 或 passerby。',
        '回复要针对这句话的具体内容，40 字以内。',
        `提示词版本：${PROMPT_VERSION}`,
      ].join('\n'),
    },
    { role: 'user', content: `书籍信息\n${bookInfo(ctx)}\n\n前文摘要\n${ctx.priorSummary || '（无）'}` },
    { role: 'user', content: `书圈记忆\n${ctx.memorySnapshot || '（空）'}` },
    { role: 'user', content: `已经读到的文本\n${ctx.textUntilHere}` },
    {
      role: 'user',
      content: [
        `接话的人\n${who || '（无）'}`,
        ctx.parentText ? `被回复的评论\n${ctx.parentText}` : '',
        `读者刚写的\n${ctx.userText}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]
}
