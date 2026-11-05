import type { ChatMessage } from '../llm/types'
import { PROMPT_VERSION } from './constraints'
import { bookInfo } from './rough'

export interface BackgroundPromptContext {
  title: string
  spoilerLevel: string
  priorSummary: string
  textUntilHere: string
  pid: string
}

export function buildBackgroundPrompt(ctx: BackgroundPromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '读者主动点了「查背景」。由考据癖补一条文本外的背景知识，帮助理解这一段。',
        '可以讲时代、翻译、典故、批评史上的常见说法。不确定就少说。禁止提本书尚未出现的情节。',
        '不要写「未核实」这几个字，界面会标注。80 到 200 字。必须带一句 4 到 30 字的原文短引文。',
        `提示词版本：${PROMPT_VERSION}`,
        '只返回一个 json 对象：{"text":"...","quote":"...","uses_outside_plot":false}',
      ].join('\n'),
    },
    { role: 'user', content: `书籍信息\n${bookInfo(ctx)}\n\n前文摘要\n${ctx.priorSummary || '（无）'}` },
    { role: 'user', content: `已经读到的文本\n${ctx.textUntilHere}\n\n当前段 ${ctx.pid}` },
  ]
}
