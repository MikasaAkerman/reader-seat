import { describe, expect, it } from 'vitest'
import { BANNED_PHRASES, PROMPT_VERSION, buildRefinePrompt, buildRoughPrompt } from '@/core/prompts'

const rough = buildRoughPrompt({
  title: '样例',
  spoilerLevel: '严格',
  memorySnapshot: '外号：（无）',
  priorSummary: '（无）',
  blockText: 'p1 天还没亮。\np2 他推开了门。',
  knownEntities: [],
})

describe('prompts v4', () => {
  it('is version 4 and lists banned phrases', () => {
    expect(PROMPT_VERSION).toBe(4)
    const system = rough[0]?.content ?? ''
    for (const phrase of BANNED_PHRASES) expect(system).toContain(phrase)
    expect(system).toContain('"paragraphs"')
    expect(system).toContain('"prediction_hits"')
    expect(rough.map((m) => m.content).join('\n')).toContain('json')
  })

  it('keeps a stable rough-prompt order', () => {
    expect(rough.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user', 'user'])
    expect(rough[1]?.content.startsWith('书友设定')).toBe(true)
    expect(rough[2]?.content.startsWith('书圈记忆')).toBe(true)
    expect(rough[3]?.content.startsWith('前文摘要')).toBe(true)
    expect(rough[4]?.content.startsWith('当前块')).toBe(true)
    expect(rough.map((m) => m.content)).toMatchSnapshot()
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
  })
})
