import type { ChatMessage } from '../llm/types'
import { fullLineup } from '../personas'
import { PROMPT_VERSION, SHARED_CONSTRAINTS } from './constraints'
import { REFINE_JSON_EXAMPLE } from './examples'

export interface RefinePromptContext {
  title: string
  spoilerLevel: string
  memorySnapshot: string
  priorSummary: string
  /** 从块首到该热段（含）的编号文本 */
  textUntilHot: string
  pid: string
  hotReason: string
  residentState: string
}

export function buildRefinePrompt(ctx: RefinePromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        SHARED_CONSTRAINTS,
        '本任务是热段精修。生成 4 到 6 条主楼。常驻书友最多 2 位，其余为路人。',
        '选 1 到 2 条主楼展开楼中楼，每楼最多 3 条回复。回复要有来由：反驳、补充、接梗、站队、回收预测。',
        '如果命中了预测，由预测者本人或其他书友点出来。',
        '可以提出新外号、预测或争议，写入 memory_updates。',
        `提示词版本：${PROMPT_VERSION}`,
        '只返回一个 json 对象。threads 里每条都要有 author_type、text、uses_outside_plot。没有回复时 replies 给空数组。memory_updates 的四个数组都要在，没有内容就给空数组。',
        '输出示例：',
        REFINE_JSON_EXAMPLE,
      ].join('\n'),
    },
    { role: 'user', content: `书友设定（完整）\n${fullLineup()}\n\n动态状态\n${ctx.residentState || '（无）'}` },
    { role: 'user', content: `书圈记忆\n${ctx.memorySnapshot || '（空）'}` },
    {
      role: 'user',
      content: `前文摘要\n${ctx.priorSummary || '（无）'}\n书名：${ctx.title}\n防剧透：${ctx.spoilerLevel}`,
    },
    {
      role: 'user',
      content: `热段 ${ctx.pid}。被评为热段的原因：${ctx.hotReason}\n\n文本（只到该段）\n${ctx.textUntilHot}`,
    },
  ]
}
