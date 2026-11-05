import type { ChatMessage } from '../llm/types'
import { briefLineup } from '../personas'
import { PROMPT_VERSION, SHARED_CONSTRAINTS } from './constraints'
import { OBSERVE_JSON_EXAMPLE } from './examples'
import { bookInfo } from './rough'

export interface ObservePromptContext {
  title: string
  author?: string
  translator?: string
  spoilerLevel: string
  memorySnapshot: string
  priorSummary: string
  beforeText?: string
  blockText: string
  knownEntities: string[]
  tasteExamples?: string
  lineupText?: string
  recentAngles?: string
  maxPicks: number
  paragraphCount: number
}

export function buildObservePrompt(ctx: ObservePromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        SHARED_CONSTRAINTS,
        '本任务只做观察，不写评论、不扮演口吻。',
        `当前块有 ${ctx.paragraphCount} 段。最多选出 ${ctx.maxPicks} 段真正有话可说的，其余不要输出。不要为了凑数每段都选。`,
        '每个选中段：score 1 到 3；1 分给 1 个观察点，2 分给 2 到 3 个，热段给 4 到 6 个。',
        '观察点 kind 只能是：动机、细节、修辞、疑问、呼应、结构、矛盾、伏笔。quote 必须是该段或之前段里 4 到 30 字的原文。point 一句话，不要写成评论。',
        'kind 为「呼应」时必须给 echo_query，用几个关键词供检索前文。',
        '每块最多 2 个热段，把它们的 pid 放进 hot_pids。近期已经说过的角度不要再列。',
        '本段首次出现的人名地名写进 new_entities。判断是否应验或推翻待验证预测，写入该段的 prediction_hits。',
        '「本章上文」只是背景，pid 只从当前块里取。',
        `提示词版本：${PROMPT_VERSION}`,
        '只返回一个 json 对象。',
        '输出示例：',
        OBSERVE_JSON_EXAMPLE,
      ].join('\n'),
    },
    { role: 'user', content: `书友关注点（精简）\n${ctx.lineupText || briefLineup()}` },
    { role: 'user', content: `书籍信息\n${bookInfo(ctx)}\n\n前文摘要\n${ctx.priorSummary || '（无）'}` },
    { role: 'user', content: `书圈记忆\n${ctx.memorySnapshot || '（空）'}` },
    {
      role: 'user',
      content: [
        ctx.beforeText ? `本章上文（只读）\n${ctx.beforeText}\n` : '',
        '当前块',
        ctx.blockText,
        `已出现实体：${ctx.knownEntities.join('、') || '（无）'}`,
        `用户口味示例：${ctx.tasteExamples || '（无）'}`,
        `近期已说过的角度：${ctx.recentAngles || '（无）'}`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
}
