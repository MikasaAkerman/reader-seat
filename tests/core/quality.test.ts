import { describe, expect, it } from 'vitest'
import {
  diversityScore,
  extractQuoted,
  gateComment,
  isNearDuplicate,
  jaccard,
  retrievePassages,
  verifyQuote,
} from '@/core/quality'

const block = {
  paragraphs: [
    { index: 1, text: '八十多天一条鱼都没有，帆上补丁摞补丁。' },
    { index: 2, text: '男孩帮他搬东西，情绪全在动作里。' },
    { index: 3, text: '他决定出远海，船还没准备好。' },
  ],
}

describe('verifyQuote', () => {
  it('accepts a short substring from a visible paragraph', () => {
    expect(verifyQuote('补丁摞补丁', block.paragraphs, 1)).toBe(true)
    expect(verifyQuote('「补丁摞补丁」', block.paragraphs, 1)).toBe(true)
  })

  it('rejects quotes that appear only later, or are too short or long', () => {
    expect(verifyQuote('他决定出远海', block.paragraphs, 2)).toBe(false)
    expect(verifyQuote('帆', block.paragraphs, 1)).toBe(false)
    expect(verifyQuote('八十多天一条鱼都没有，帆上补丁摞补丁。还要再写很长', block.paragraphs, 1)).toBe(false)
  })

  it('extracts wrapped quotes from comment text', () => {
    expect(extractQuoted('注意「补丁摞补丁」这四个字')).toEqual(['补丁摞补丁'])
  })
})

describe('similarity', () => {
  it('treats copied voice samples as duplicates and keeps distinct angles', () => {
    const sample = '这句话先别滑过去。'
    expect(isNearDuplicate('这句话先别滑过去。', [sample])).toBe(true)
    expect(isNearDuplicate('换我早受不了了，他怎么还撑着。', [sample])).toBe(false)
    const near = '这句话先别滑过去啊。'
    expect(isNearDuplicate(near, [sample])).toBe(true)
  })

  it('ignores shared quotes when comparing two comments on the same line', () => {
    const quote = '补丁摞补丁'
    const a = '帆写成「补丁摞补丁」，失败感一开始就挂上了。'
    const b = '「补丁摞补丁」这四个字把穷写进了布里。'
    expect(jaccard(a, b)).toBeLessThan(0.45)
    expect(isNearDuplicate(a, [b], 0.45, [quote])).toBe(false)
  })

  it('scores a mixed corpus as more diverse than copies', () => {
    const copies = ['换我早受不了了', '换我早受不了了啊', '换我可受不了']
    const mixed = ['换我早受不了了', '注意这里的视角', '帆上的补丁才是基调']
    expect(diversityScore(mixed)).toBeGreaterThan(diversityScore(copies))
  })
})

describe('retrievePassages', () => {
  it('prefers an exact earlier mention', () => {
    const corpus = [
      { text: '老人补了几次那张帆。', chapterTitle: '开篇', score: 0 },
      { text: '男孩从别的船上回来。', chapterTitle: '开篇', score: 0 },
    ]
    const found = retrievePassages('那张帆', corpus, 1)
    expect(found[0]?.text).toContain('帆')
  })
})

describe('gateComment', () => {
  it('drops outside-plot, unmatched quotes, later entities, and duplicates', () => {
    const known = new Set(['老人'])
    const common = {
      paragraphIndex: 1,
      block,
      knownEntities: known,
      newEntities: ['男孩'],
      corpus: [] as string[],
    }
    expect(
      gateComment({ ...common, text: '补丁摞补丁，一开始就把失败挂上了。', quote: '补丁摞补丁', usesOutsidePlot: true }),
    ).toEqual({ ok: false, reason: 'outside' })
    expect(
      gateComment({ ...common, text: '后文会有大鱼。', quote: '后文会有大鱼', usesOutsidePlot: false }),
    ).toEqual({ ok: false, reason: 'quote' })
    expect(
      gateComment({
        ...common,
        text: '男孩这时还没出场。',
        quote: '补丁摞补丁',
        usesOutsidePlot: false,
      }),
    ).toEqual({ ok: false, reason: 'entity' })
    expect(
      gateComment({
        ...common,
        text: '帆上「补丁摞补丁」，失败感开篇就挂上了。',
        quote: '补丁摞补丁',
        usesOutsidePlot: false,
        corpus: ['帆上「补丁摞补丁」，失败感开篇就挂上了。'],
      }),
    ).toEqual({ ok: false, reason: 'duplicate' })
    expect(
      gateComment({
        ...common,
        text: '帆写成「补丁摞补丁」，开篇就把基调挂在桅杆上了。',
        quote: '补丁摞补丁',
        usesOutsidePlot: false,
      }),
    ).toEqual({ ok: true })
  })
})
