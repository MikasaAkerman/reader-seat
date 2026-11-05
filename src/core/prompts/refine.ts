import type { ChatMessage } from '../llm/types'
import { fullLineup } from '../personas'
import { PROMPT_VERSION, SHARED_CONSTRAINTS } from './constraints'
import { REFINE_JSON_EXAMPLE } from './examples'
import { bookInfo } from './rough'

export interface RefinePromptContext {
  title: string
  spoilerLevel: string
  memorySnapshot: string
  priorSummary: string
  textUntilHot: string
  pid: string
  hotReason: string
  residentState: string
  lineupText?: string
  tasteExamples?: string
  assignments?: string
  recentComments?: string
}

export function buildRefinePrompt(ctx: RefinePromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        SHARED_CONSTRAINTS,
        '本任务是热段精修。按下面已经分配好的观察点写 4 到 6 条主楼。常驻书友最多 2 位，其余为路人。不要另起观察点。',
        '每条主楼都要带原文短引文。选 1 到 2 条主楼展开楼中楼，每楼最多 3 条回复。回复要有来由：反驳、补充、接梗、站队、回收预测。',
        '如果命中了预测，由预测者本人或其他书友点出来。',
        '可以提出新外号、预测或争议，写入 memory_updates。',
        `提示词版本：${PROMPT_VERSION}`,
        '只返回一个 json 对象。threads 里每条都要有 author_type、text、quote、uses_outside_plot。没有回复时 replies 给空数组。memory_updates 的四个数组都要在，没有内容就给空数组。',
        '输出示例：',
        REFINE_JSON_EXAMPLE,
      ].join('\n'),
    },
    { role: 'user', content: `书友设定（完整）\n${ctx.lineupText || fullLineup()}` },
    { role: 'user', content: `书籍信息\n${bookInfo(ctx)}\n\n前文摘要\n${ctx.priorSummary || '（无）'}` },
    {
      role: 'user',
      content: `书圈记忆\n${ctx.memorySnapshot || '（空）'}\n\n书友动态状态\n${ctx.residentState || '（无）'}`,
    },
    {
      role: 'user',
      content: [
        `文本（只到该段）\n${ctx.textUntilHot}`,
        `热段 ${ctx.pid}。被评为热段的原因：${ctx.hotReason}`,
        `已分配的观察点\n${ctx.assignments || '（无，请按文本自选不同角度，仍须带引文）'}`,
        `近期已经说过的话\n${ctx.recentComments || '（无）'}`,
        `用户口味示例：${ctx.tasteExamples || '（无）'}`,
      ].join('\n\n'),
    },
  ]
}
