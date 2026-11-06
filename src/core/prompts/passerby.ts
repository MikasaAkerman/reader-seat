import type { ChatMessage } from '../llm/types'
import { PROMPT_VERSION } from './constraints'

export interface PasserbyPromptContext {
  text: string
  kept: string
  names?: string
}

export function buildPasserbyPrompt(ctx: PasserbyPromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '本任务只换路人。写 2 到 3 条口语短评，每条建议 40 字左右。写短或写长都可以。',
        '不要写常驻书友，不要重复下面已经留下的发言。',
        '只用这一段里已经出现的内容，不要提后文，不要补充文本外的事实。',
        `提示词版本：${PROMPT_VERSION}`,
        '只返回一个 json 对象。comments 里每条有 display_name、text、uses_outside_plot。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `已留下的发言\n${ctx.kept || '（无）'}\n\n路人身份（按顺序用这些名字）\n${ctx.names || '（随机）'}\n\n这一段\n${ctx.text}`,
    },
  ]
}
