import type { ChatMessage } from '../llm/types'

export interface SpoilerPromptContext {
  spoilerLevel: string
  priorSummary: string
  text: string
  comments: { id: string; text: string }[]
}

export function buildSpoilerPrompt(ctx: SpoilerPromptContext): ChatMessage[] {
  const lines = ctx.comments.map((comment) => `${comment.id} ${comment.text}`).join('\n')
  return [
    {
      role: 'system',
      content: [
        '你在检查读书评论有没有剧透。逐条判断评论是否提及或暗示了所给文本之外的情节。',
        '防剧透为「可暗示」时，只能暗示重要性，不能暗示方向，例如不能说谁会死、谁不可信。',
        '只依据给出的前文摘要和当前文本。拿不准就判不通过。',
        '只返回一个 json 对象，results 里每条有 id 和 pass。pass 为 false 表示不通过。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `防剧透：${ctx.spoilerLevel}\n前文摘要\n${ctx.priorSummary || '（无）'}\n\n当前文本\n${ctx.text}\n\n待校验\n${lines || '（无）'}`,
    },
  ]
}
