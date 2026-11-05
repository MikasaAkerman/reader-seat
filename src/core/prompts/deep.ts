import type { ChatMessage } from '../llm/types'
import { fullLineup } from '../personas'
import { PROMPT_VERSION } from './constraints'
import { DEEP_JSON_EXAMPLE, DEEP_PLAN_EXAMPLE } from './examples'
import { bookInfo } from './rough'

export interface DeepPlanPromptContext {
  title: string
  spoilerLevel: string
  chapterTitle: string
  synopsis?: string
  priorSummary?: string
  readText: string
  maxSpots: number
  stationLens?: string
}

export interface DeepPromptContext {
  title: string
  spoilerLevel: string
  memorySnapshot: string
  priorSummary: string
  sceneText: string
  earlierPassages: string
  stationLens?: string
  label: string
  why: string
  lens: string
  lineupText?: string
}

export function buildDeepPlanPrompt(ctx: DeepPlanPromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你在为一部名著的评论区挑选真正值得深入讨论的场景。不要写评论。',
        `最多选出 ${ctx.maxSpots} 处。没有值得深入的地方就返回空数组。`,
        '选对话或独白的收束处、转折、叙述手法集中的地方。start_pid 是场景开头，end_pid 是收束段，都用当前章的编号。',
        '不要选过渡、场面调度或单纯交代。',
        `提示词版本：${PROMPT_VERSION}`,
        '只返回一个 json 对象。',
        '输出示例：',
        DEEP_PLAN_EXAMPLE,
      ].join('\n'),
    },
    { role: 'user', content: `书籍信息\n${bookInfo(ctx)}\n\n此前梗概\n${ctx.synopsis || ctx.priorSummary || '（无）'}` },
    {
      role: 'user',
      content: [
        `章节：${ctx.chapterTitle}`,
        ctx.stationLens ? `阅读计划视角\n${ctx.stationLens}` : '',
        `已读正文\n${ctx.readText}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]
}

export function buildDeepPrompt(ctx: DeepPromptContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你在写一篇名著场景的深读长评，像认真的书友，不像学期论文。',
        '书友只知道下面给出的文本。禁止提本书尚未出现的情节。',
        '主评 400 到 800 字：一个判断、至少两处原文证据、一个保留。反方 200 到 500 字：回应主评并给出替代解读。主评和反方必须是不同的书友。',
        'evidence 里的 quote 必须是场景正文里 4 到 30 字的原句片段，并标明 pid。',
        'background 可选，用来放批评传统或创作背景，200 字内，不得涉及本书后文。不确定就不写。',
        '最后留一个具体问题给读者。',
        `提示词版本：${PROMPT_VERSION}`,
        '只返回一个 json 对象。',
        '输出示例：',
        DEEP_JSON_EXAMPLE,
      ].join('\n'),
    },
    { role: 'user', content: `书友设定\n${ctx.lineupText || fullLineup()}` },
    { role: 'user', content: `书籍信息\n${bookInfo(ctx)}\n\n前文摘要\n${ctx.priorSummary || '（无）'}` },
    { role: 'user', content: `书圈记忆\n${ctx.memorySnapshot || '（空）'}` },
    {
      role: 'user',
      content: [
        `场景：${ctx.label}。${ctx.why}`,
        ctx.lens ? `这一处的分析视角：${ctx.lens}` : '',
        ctx.stationLens ? `阅读计划视角\n${ctx.stationLens}` : '',
        ctx.earlierPassages ? `检索到的前文原文\n${ctx.earlierPassages}` : '',
        `场景正文（只到收束段）\n${ctx.sceneText}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]
}
