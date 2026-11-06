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
        '你在检查读书评论有没有剧透。只依据给出的前文摘要和当前文本。',
        '防剧透为「严格」时，提及或暗示所给文本之外的情节就不通过。拿不准就判不通过。',
        '防剧透为「可暗示」时，只拦方向性剧透，例如谁会死、谁不可信。只说某处重要、值得留意，可以通过。不要因为评论超出眼前这一段就判失败。拿不准就通过。',
        '防剧透为「全开放」时，全部通过。',
        '只返回一个 json 对象，results 里每条有 id 和 pass。pass 为 false 表示不通过。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `防剧透：${ctx.spoilerLevel}\n前文摘要\n${ctx.priorSummary || '（无）'}\n\n当前文本\n${ctx.text}\n\n待校验\n${lines || '（无）'}`,
    },
  ]
}
