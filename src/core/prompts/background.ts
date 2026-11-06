import type { ChatMessage } from '../llm/types'
import { PROMPT_VERSION } from './constraints'
import { bookInfo } from './rough'

export interface BackgroundPromptContext {
  title: string
  spoilerLevel: string
  priorSummary: string
  textUntilHere: string
  pid: string
  /** 上一次引文对不上原文，再要一次精确引文。 */
  quoteRetry?: boolean
}

export function buildBackgroundPrompt(ctx: BackgroundPromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '读者主动点了「查背景」。由考据癖补一条文本外的背景知识，帮助理解这一段。',
        '可以讲时代、翻译、典故、批评史上的常见说法。不确定就少说。禁止提本书尚未出现的情节。',
        '不要写「未核实」这几个字，界面会标注。建议 80 到 200 字，写短或写长都可以。quote 必须是已读正文里的连续原文，建议 4 到 30 字，更长也可以，不要改写。',
        ctx.quoteRetry ? '上一次的 quote 对不上原文。请换一句正文里实际出现的连续片段。' : '',
        `提示词版本：${PROMPT_VERSION}`,
        '只返回一个 json 对象：{"text":"...","quote":"...","uses_outside_plot":false}',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { role: 'user', content: `书籍信息\n${bookInfo(ctx)}\n\n前文摘要\n${ctx.priorSummary || '（无）'}` },
    { role: 'user', content: `已经读到的文本\n${ctx.textUntilHere}\n\n当前段 ${ctx.pid}` },
  ]
}
