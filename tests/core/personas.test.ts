import { describe, expect, it } from 'vitest'
import { DEFAULT_LINEUP, samplePassersby } from '@/core/personas'

describe('personas', () => {
  it('ships five residents with voice, focus, and taboos', () => {
    expect(DEFAULT_LINEUP.map((p) => p.role)).toEqual([
      '头回读',
      '课代表',
      '考据癖',
      '毒舌',
      '老书虫',
    ])
    for (const persona of DEFAULT_LINEUP) {
      expect(persona.voice.length).toBeGreaterThan(0)
      expect(persona.voiceSamples.length).toBeGreaterThanOrEqual(3)
      expect(persona.focus.length).toBeGreaterThan(0)
      expect(persona.taboos.length).toBeGreaterThan(0)
    }
    const toxic = DEFAULT_LINEUP.find((p) => p.role === '毒舌')
    expect(toxic?.relations.some((r) => r.with === '头回读')).toBe(true)
  })

  it('samples the same passersby for the same seed', () => {
    const a = samplePassersby('para-7', 3)
    const b = samplePassersby('para-7', 3)
    expect(a).toEqual(b)
  })

  it('does not repeat a passerby combination inside one paragraph', () => {
    const people = samplePassersby('para-7', 4)
    const keys = people.map((p) => p.sampledDims.join('|'))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
