import type { ChatMessage } from '../llm/types'
import { briefLineup } from '../personas'
import { PROMPT_VERSION, SHARED_CONSTRAINTS } from './constraints'
import { ROUGH_JSON_EXAMPLE } from './examples'

export interface RoughPromptContext {
  title: string
  author?: string
  translator?: string
  spoilerLevel: string
  memorySnapshot: string
  priorSummary: string
  blockText: string
  knownEntities: string[]
  tasteExamples?: string
}

export function buildRoughPrompt(ctx: RoughPromptContext): ChatMessage[] {
  const book = [
    `书名：${ctx.title}`,
    ctx.author ? `作者：${ctx.author}` : '',
    ctx.translator ? `译者：${ctx.translator}` : '',
    `防剧透档位：${ctx.spoilerLevel}`,
    `提示词版本：${PROMPT_VERSION}`,
  ]
    .filter(Boolean)
    .join('\n')

  return [
    {
      role: 'system',
      content: [
        SHARED_CONSTRAINTS,
        '本任务是粗生成。逐段打分 0 到 3：0 不写评论，1 写 0 到 1 条，2 写 2 到 3 条，3 是热段只打分不写评论。每块最多 2 个热段。',
        '人名地名典故首次出现且可能难懂时，由考据癖补一条，放进对应段的 comments 或 background_note。',
        '判断每段是否应验或推翻待验证预测，写入 prediction_hits；没有则给空数组。',
        '只返回一个 json 对象。score 必须是数字 0 到 3。每条评论都要有 author_type、text、reaction_type、stance、uses_outside_plot。',
        '输出示例：',
        ROUGH_JSON_EXAMPLE,
      ].join('\n'),
    },
    { role: 'user', content: `书友设定（精简）\n${briefLineup()}` },
    { role: 'user', content: `书圈记忆\n${ctx.memorySnapshot || '（空）'}` },
    { role: 'user', content: `前文摘要\n${ctx.priorSummary || '（无）'}\n\n书籍信息\n${book}` },
    {
      role: 'user',
      content: [
        '当前块',
        ctx.blockText,
        `已出现实体：${ctx.knownEntities.join('、') || '（无）'}`,
        `用户口味示例：${ctx.tasteExamples || '（无）'}`,
      ].join('\n'),
    },
  ]
}
