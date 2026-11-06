import { describe, expect, it } from 'vitest'
import {
  BANNED_PHRASES,
  PROMPT_VERSION,
  buildChapterTalkPrompt,
  buildDialoguePrompt,
  buildLivePrompt,
  buildPasserbyPrompt,
  buildObservePrompt,
  buildRefinePrompt,
  buildVoicePrompt,
} from '@/core/prompts'

const observeCtx = {
  title: '样例',
  spoilerLevel: '严格',
  memorySnapshot: '外号：（无）',
  priorSummary: '（无）',
  blockText: 'p1 天还没亮。\np2 他推开了门。',
  knownEntities: [] as string[],
  maxPicks: 1,
  paragraphCount: 2,
}
const observe = buildObservePrompt(observeCtx)

describe('prompts v7', () => {
  it('is version 7 and lists banned phrases', () => {
    expect(PROMPT_VERSION).toBe(7)
    const system = observe[0]?.content ?? ''
    for (const phrase of BANNED_PHRASES) expect(system).toContain(phrase)
    expect(system).toContain('只做观察')
    expect(system).toContain('hot_pids')
    expect(observe.map((m) => m.content).join('\n')).toContain('json')
  })

  it('puts the most stable messages first in the observe prompt', () => {
    expect(observe.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user', 'user'])
    expect(observe[1]?.content.startsWith('书友关注点')).toBe(true)
    expect(observe[2]?.content.startsWith('书籍信息')).toBe(true)
    expect(observe[2]?.content).toContain('前文摘要')
    expect(observe[3]?.content.startsWith('书圈记忆')).toBe(true)
    expect(observe[4]?.content).toContain('当前块')
    expect(observe.map((m) => m.content)).toMatchSnapshot()
  })

  it('keeps the system and first messages identical between blocks of a chapter', () => {
    const next = buildObservePrompt({ ...observeCtx, blockText: 'p1 门外有人。', memorySnapshot: '外号：老周' })
    expect(next.slice(0, 3)).toEqual(observe.slice(0, 3))
  })

  it('marks preceding text as read-only', () => {
    const withBefore = buildObservePrompt({ ...observeCtx, beforeText: 'p0 前一段。' })
    expect(withBefore[4]?.content.startsWith('本章上文（只读）')).toBe(true)
  })

  it('asks voice for assigned cid lines', () => {
    const messages = buildVoicePrompt({
      assignments: 'c1 | p1 | 常驻 毒舌 | 观察：矛盾 | 引文：天还没亮',
      recentComments: '这句话先别滑过去。',
    })
    expect(messages[0]?.content).toContain('一行一个 json 对象')
    expect(messages[1]?.content).toContain('c1')
    expect(messages[1]?.content).toContain('这句话先别滑过去')
  })

  it('asks refine for assigned observations and a json object', () => {
    const messages = buildRefinePrompt({
      title: '样例',
      spoilerLevel: '严格',
      memorySnapshot: '（空）',
      priorSummary: '（无）',
      textUntilHot: 'p1 天还没亮。',
      pid: 'p1',
      hotReason: '观察步骤评为热段',
      residentState: '（无）',
      assignments: 'c1 | 动机 | 引文：天还没亮',
    })
    const system = messages[0]?.content ?? ''
    expect(system).toContain('4 到 6 条主楼')
    expect(system).toContain('常驻书友最多 2 位')
    expect(system).toContain('原文短引文')
    expect(messages[4]?.content).toContain('已分配的观察点')
  })

  it('ends the live prompt with what the reader just wrote', () => {
    const messages = buildLivePrompt({
      title: '样例',
      spoilerLevel: '严格',
      memorySnapshot: '（空）',
      priorSummary: '（无）',
      textUntilHere: 'p1 天还没亮。',
      userText: '这开头好冷',
      repliers: [{ role: '共情派', displayName: '共情派', voice: '' }],
    })
    expect(messages.at(-1)?.content).toContain('这开头好冷')
    expect(messages.map((item) => item.content).join('\n')).toContain('建议 40 字左右')
  })

  it('answers the reader when there is no mention', () => {
    const messages = buildDialoguePrompt({
      title: '样例',
      spoilerLevel: '严格',
      memorySnapshot: '（空）',
      priorSummary: '（无）',
      textUntilHere: 'p1 天还没亮。',
      userText: '为什么天还没亮？',
      speakerName: '课代表',
      speakerVoice: '把这一段讲清楚',
    })
    const all = messages.map((item) => item.content).join('\n')
    expect(all).toContain('为什么天还没亮？')
    expect(all).toContain('根据这句话回答')
    expect(all).not.toContain('不回答问题')
    expect(all).not.toContain('40 字以内')
  })

  it('asks passersby for short lines without the shared short-comment ban', () => {
    const messages = buildPasserbyPrompt({ text: '天还没亮。', kept: '课代表：冷。' })
    const all = messages.map((item) => item.content).join('\n')
    expect(all).toContain('2 到 3 条')
    expect(all).not.toContain('不回答问题')
  })

  it('passes the synopsis to chapter talk and asks for a synopsis update', () => {
    const messages = buildChapterTalkPrompt({
      title: '样例',
      spoilerLevel: '严格',
      memorySnapshot: '（空）',
      synopsis: '主角离家。',
      chapterTitle: '第二章',
      readText: 'p1 天还没亮。',
    })
    const all = messages.map((m) => m.content).join('\n')
    expect(all).toContain('主角离家。')
    expect(all).toContain('synopsis_update')
  })
})
