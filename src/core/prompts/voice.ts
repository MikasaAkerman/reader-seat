import type { ChatMessage } from '../llm/types'
import { PROMPT_VERSION, SHARED_CONSTRAINTS } from './constraints'
import { VOICE_JSONL_EXAMPLE } from './examples'

export interface VoicePromptContext {
  assignments: string
  recentComments: string
  rejected?: string
}

export function buildVoicePrompt(ctx: VoicePromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        SHARED_CONSTRAINTS,
        '本任务是口吻。下面每条已经分配好观察点和说话人。每位只把分到的那一个观察点用自己的口吻说出来，不要换观察点，不要互相抢。',
        '多样性已经在观察层产生。不要靠换措辞硬造差异，更不要照抄口吻样本或近期评论。',
        '每条必须带回给定的原文短引文。quote 字段原样带回。',
        '按 cid 逐条输出，一行一个 json 对象，不要包在数组里，不要代码块。',
        `提示词版本：${PROMPT_VERSION}`,
        '输出示例：',
        VOICE_JSONL_EXAMPLE,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `分配清单\n${ctx.assignments}`,
        `近期已经说过的话（不要像它们）\n${ctx.recentComments || '（无）'}`,
        ctx.rejected ? `上次被拒、需要重写的条目\n${ctx.rejected}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]
}
