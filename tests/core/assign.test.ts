import { describe, expect, it } from 'vitest'
import { assignObservations, maxPicks } from '@/core/generation/assign'
import { DEFAULT_LINEUP } from '@/core/personas'
import type { ObserveResult } from '@/core/generation/schema'

const block = {
  paragraphs: [
    { index: 1, text: '八十多天一条鱼都没有。' },
    { index: 2, text: '帆上补丁摞补丁，像一面失败的旗子。' },
    { index: 3, text: '男孩帮他搬东西。' },
  ],
}

function observe(partial: Partial<ObserveResult> = {}): ObserveResult {
  return {
    paragraphs: [
      {
        pid: 'p2',
        score: 2,
        observations: [
          { oid: 'o1', kind: '修辞', quote: '补丁摞补丁', point: '开篇就把失败写成旗子' },
          { oid: 'o2', kind: '矛盾', quote: '失败的旗子', point: '旗子通常光荣，这里是失败' },
        ],
        prediction_hits: [],
      },
    ],
    hot_pids: [],
    new_entities: [],
    ...partial,
  }
}

describe('maxPicks', () => {
  it('caps selected paragraphs by block size', () => {
    expect(maxPicks(1)).toBe(1)
    expect(maxPicks(5)).toBe(2)
    expect(maxPicks(15)).toBe(5)
  })
})

describe('assignObservations', () => {
  it('gives different observations to different speakers', () => {
    const result = assignObservations({
      result: observe(),
      block,
      lineup: DEFAULT_LINEUP,
      recentAngles: [],
      passages: [],
      seed: 't1',
    })
    expect(result.slots).toHaveLength(2)
    expect(new Set(result.slots.map((slot) => `${slot.authorType}:${slot.displayName}`)).size).toBe(2)
    expect(result.slots[0]?.readerRole).toBe('课代表')
    expect(result.slots[1]?.readerRole).toBe('毒舌')
  })

  it('drops unmatched quotes and similar angles', () => {
    const result = assignObservations({
      result: observe({
        paragraphs: [
          {
            pid: 'p2',
            score: 2,
            observations: [
              { oid: 'o1', kind: '修辞', quote: '后文大鱼', point: '编的' },
              { oid: 'o2', kind: '修辞', quote: '补丁摞补丁', point: '开篇就把失败写成旗子' },
            ],
            prediction_hits: [],
          },
        ],
      }),
      block,
      lineup: DEFAULT_LINEUP,
      recentAngles: ['修辞：开篇就把失败写成旗子'],
      passages: [],
      seed: 't2',
    })
    expect(result.slots).toHaveLength(0)
    expect(result.dropped.quote).toBeGreaterThan(0)
  })

  it('hands leftover observations to sampled passersby and drops echoes with no earlier text', () => {
    const result = assignObservations({
      result: observe({
        paragraphs: [
          {
            pid: 'p2',
            score: 2,
            observations: [
              { oid: 'o1', kind: '修辞', quote: '补丁摞补丁', point: '失败写成旗子' },
              { oid: 'o2', kind: '矛盾', quote: '失败的旗子', point: '旗子通常光荣' },
              { oid: 'o4', kind: '呼应', quote: '补丁摞补丁', point: '和前文那张帆有关', echo_query: '那张帆' },
              { oid: 'o3', kind: '细节', quote: '补丁摞补丁', point: '补丁是具体物象' },
            ],
            prediction_hits: [],
          },
        ],
      }),
      block,
      lineup: DEFAULT_LINEUP,
      recentAngles: [],
      passages: [],
      seed: 't3',
    })
    expect(result.slots.map((slot) => slot.authorType)).toEqual(['resident', 'resident', 'passerby'])
    expect(result.dropped.quote).toBeGreaterThan(0)
  })
})
