import { describe, expect, it } from 'vitest'
import {
  BANNED_PHRASES,
  PROMPT_VERSION,
  buildChapterTalkPrompt,
  buildLivePrompt,
  buildRefinePrompt,
  buildRoughPrompt,
} from '@/core/prompts'

const roughCtx = {
  title: '样例',
  spoilerLevel: '严格',
  memorySnapshot: '外号：（无）',
  priorSummary: '（无）',
  blockText: 'p1 天还没亮。\np2 他推开了门。',
  knownEntities: [],
}
const rough = buildRoughPrompt(roughCtx)

describe('prompts v5', () => {
  it('is version 5 and lists banned phrases', () => {
    expect(PROMPT_VERSION).toBe(5)
    const system = rough[0]?.content ?? ''
    for (const phrase of BANNED_PHRASES) expect(system).toContain(phrase)
    expect(system).toContain('"paragraphs"')
    expect(system).toContain('"prediction_hits"')
    expect(rough.map((m) => m.content).join('\n')).toContain('json')
  })

  it('puts the most stable messages first in the rough prompt', () => {
    expect(rough.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user', 'user'])
    expect(rough[1]?.content.startsWith('书友设定')).toBe(true)
    expect(rough[2]?.content.startsWith('书籍信息')).toBe(true)
    expect(rough[2]?.content).toContain('前文摘要')
    expect(rough[3]?.content.startsWith('书圈记忆')).toBe(true)
    expect(rough[4]?.content.startsWith('当前块')).toBe(true)
    expect(rough.map((m) => m.content)).toMatchSnapshot()
  })

  it('keeps the system and first messages identical between blocks of a chapter', () => {
    const next = buildRoughPrompt({ ...roughCtx, blockText: 'p1 门外有人。', memorySnapshot: '外号：老周' })
    expect(next.slice(0, 3)).toEqual(rough.slice(0, 3))
  })

  it('marks preceding text as read-only and asks for json lines when streaming', () => {
    const streamed = buildRoughPrompt({ ...roughCtx, beforeText: 'p0 前一段。' }, 'jsonl')
    expect(streamed[4]?.content.startsWith('本章上文（只读）')).toBe(true)
    expect(streamed[0]?.content).toContain('一行一个 json 对象')
    expect(streamed[0]?.content).toContain('new_entities')
  })

  it('asks refine for threads and a json object', () => {
    const messages = buildRefinePrompt({
      title: '样例',
      spoilerLevel: '严格',
      memorySnapshot: '（空）',
      priorSummary: '（无）',
      textUntilHot: 'p1 天还没亮。',
      pid: 'p1',
      hotReason: '粗评分为 3',
      residentState: '（无）',
    })
    const system = messages[0]?.content ?? ''
    expect(system).toContain('4 到 6 条主楼')
    expect(system).toContain('常驻书友最多 2 位')
    expect(system).toContain('1 到 2')
    expect(system).toContain('最多 3 条回复')
    expect(system).toContain('"threads"')
    expect(system).toContain('"memory_updates"')
    expect(system).toContain('json')
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user', 'user'])
    expect(messages[2]?.content.startsWith('书籍信息')).toBe(true)
    expect(messages[4]?.content).toContain('p1')
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
