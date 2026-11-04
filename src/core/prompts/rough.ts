import type { ChatMessage } from '../llm/types'
import { briefLineup } from '../personas'
import { PROMPT_VERSION, SHARED_CONSTRAINTS } from './constraints'
import { ROUGH_JSON_EXAMPLE, ROUGH_JSONL_EXAMPLE } from './examples'

export interface RoughPromptContext {
  title: string
  author?: string
  translator?: string
  spoilerLevel: string
  memorySnapshot: string
  priorSummary: string
  /** 本章里块前面的几段，只读，不评论 */
  beforeText?: string
  blockText: string
  knownEntities: string[]
  tasteExamples?: string
  lineupText?: string
}

export function bookInfo(ctx: { title: string; author?: string; translator?: string; spoilerLevel: string }): string {
  return [
    `书名：${ctx.title}`,
    ctx.author ? `作者：${ctx.author}` : '',
    ctx.translator ? `译者：${ctx.translator}` : '',
    `防剧透档位：${ctx.spoilerLevel}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 消息顺序按"越稳定越靠前"排，方便命中前缀缓存：
 * 系统提示、书友设定、书籍信息和前情（同一章内不变）、书圈记忆（每块都可能变）、本块内容。
 */
export function buildRoughPrompt(ctx: RoughPromptContext, format: 'json' | 'jsonl' = 'json'): ChatMessage[] {
  const output =
    format === 'jsonl'
      ? [
          '按段落顺序逐段输出，一行一个 json 对象，不要包在数组里，不要换行排版，不要代码块。当前块每一段都要有一行。',
          'score 必须是数字 0 到 3。每条评论都要有 author_type 和 text；常驻书友写 reader_role，路人写 display_name；用到当前文本之外的情节时 uses_outside_plot 写 true。',
          '本段首次出现的人名地名写进这一行的 new_entities。',
          '输出示例：',
          ROUGH_JSONL_EXAMPLE,
        ]
      : [
          '只返回一个 json 对象。score 必须是数字 0 到 3。每条评论都要有 author_type 和 text；常驻书友写 reader_role，路人写 display_name；用到当前文本之外的情节时 uses_outside_plot 写 true。',
          '输出示例：',
          ROUGH_JSON_EXAMPLE,
        ]
  return [
    {
      role: 'system',
      content: [
        SHARED_CONSTRAINTS,
        '本任务是粗生成。逐段打分 0 到 3：0 不写评论，1 写 0 到 1 条，2 写 2 到 3 条，3 是热段，先写 1 条短评占位，稍后会单独展开。每块最多 2 个热段。',
        '「本章上文」只是背景，不要给它写评论，pid 只从当前块里取。',
        '人名地名典故首次出现且可能难懂时，由考据癖在对应段补一条。',
        '判断每段是否应验或推翻待验证预测，写入 prediction_hits；没有就省略这个字段。',
        `提示词版本：${PROMPT_VERSION}`,
        ...output,
      ].join('\n'),
    },
    { role: 'user', content: `书友设定（精简）\n${ctx.lineupText || briefLineup()}` },
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
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
}
