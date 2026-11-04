import type { ChatMessage } from '../llm/types'
import { PROMPT_VERSION, SHARED_CONSTRAINTS } from './constraints'

export interface PasserbyPromptContext {
  text: string
  kept: string
}

export function buildPasserbyPrompt(ctx: PasserbyPromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        SHARED_CONSTRAINTS,
        '本任务只换路人。写 2 到 3 条路人短评，不要写常驻书友，不要重复下面已经留下的发言。',
        `提示词版本：${PROMPT_VERSION}`,
        '只返回一个 json 对象。comments 里每条有 display_name、text、uses_outside_plot。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `已留下的发言\n${ctx.kept || '（无）'}\n\n这一段\n${ctx.text}`,
    },
  ]
}
