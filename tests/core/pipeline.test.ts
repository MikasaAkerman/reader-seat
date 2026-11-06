import { describe, expect, it } from 'vitest'
import {
  assignGeneration,
  assignOne,
  COLD_BLOCK_PARAS,
  JUMP_BLOCK_PARAS,
  commentCount,
  deepSpotRange,
  generatesShort,
  jumpBlock,
  lineupFor,
  planNextBlock,
  readyAhead,
} from '@/core/generation/pipeline'
import type { RoughParagraph } from '@/core/generation/schema'
import type { ParagraphRow } from '@/db/schema'
import { bubbleFor } from '@/db/repos/comments'

function row(
  order: number,
  extra: Partial<ParagraphRow> = {},
  text = '一句很短的话。',
): ParagraphRow {
  return {
    id: `p${order}`,
    bookId: 'b',
    chapterId: 'c',
    order,
    anchor: String(order),
    text,
    html: `<p>${text}</p>`,
    textHash: String(order),
    kind: 'body',
    genStatus: 'none',
    ...extra,
  }
}

function generated(pid: string, score: 0 | 1 | 2 | 3, text = '有意思'): RoughParagraph {
  return {
    pid,
    score,
    comments:
      score === 0
        ? []
        : [
            {
              author_type: 'resident',
              reader_role: '考据癖',
              display_name: '考据癖',
              text,
              reaction_type: '',
              stance: '',
              uses_outside_plot: false,
            },
          ],
    prediction_hits: [],
  }
}

describe('planNextBlock', () => {
  it('starts at the current paragraph and keeps one block inside fifteen paragraphs', () => {
    const rows = Array.from({ length: 16 }, (_, index) => row(index + 1))
    const block = planNextBlock(rows, 1)
    expect(block?.map((item) => item.order)).toEqual(Array.from({ length: 15 }, (_, index) => index + 1))
    expect(planNextBlock(rows, 4)?.[0]?.order).toBe(4)
  })

  it('skips paragraphs already being generated', () => {
    const rows = [row(1), row(2), row(3)]
    expect(planNextBlock(rows, 1, new Set(['p1']))?.map((item) => item.id)).toEqual(['p2', 'p3'])
  })
})

describe('readyAhead', () => {
  it('counts finished paragraphs, skips failures, and stops at an unstarted paragraph', () => {
    const rows = [
      row(1, { genStatus: 'rough', score: 2 }),
      row(2, { genStatus: 'failed' }),
      row(3, { genStatus: 'refined', score: 3 }),
      row(4, { genStatus: 'none' }),
      row(5, { genStatus: 'rough', score: 1 }),
    ]
    expect(readyAhead(rows, 1)).toBe(2)
    expect(readyAhead(rows, 1, new Set(['p4']))).toBe(4)
  })
})

describe('book comment gates', () => {
  it('treats missing switches as on, and keeps the minimum from passing the maximum', () => {
    expect(generatesShort({})).toBe(true)
    expect(generatesShort({ shortComments: false })).toBe(false)
    expect(deepSpotRange({})).toEqual({ min: 1, max: 1 })
    expect(deepSpotRange({ longComments: false, deepMinPerChapter: 4, deepMaxPerChapter: 9 })).toEqual({
      min: 0,
      max: 0,
    })
    expect(deepSpotRange({ deepMinPerChapter: 4, deepMaxPerChapter: 2 })).toEqual({ min: 4, max: 4 })
    expect(commentCount(2.6)).toBe(3)
    expect(commentCount(0)).toBe(1)
  })
})

describe('lineupFor', () => {
  it('removes 老书虫 from the strict lineup', () => {
    expect(lineupFor('严格').some((persona) => persona.role === '老书虫')).toBe(false)
    expect(lineupFor('全开放').some((persona) => persona.role === '老书虫')).toBe(true)
    expect(lineupFor('严格', { 考据癖: false }).some((persona) => persona.role === '考据癖')).toBe(false)
  })
})

describe('assignGeneration', () => {
  it('scores headings as zero and keeps at most two hot paragraphs', () => {
    const rows = [
      row(1, { kind: 'heading' }),
      row(2),
      row(3),
      row(4),
    ]
    const assigned = assignGeneration(rows, [
      generated('p1', 3),
      generated('p2', 3, '热一'),
      generated('p3', 3, '热二'),
      generated('p4', 3, '热三'),
    ])
    expect(assigned[0]).toMatchObject({ score: 0, hot: false, genStatus: 'rough', comments: [] })
    expect(assigned[1]).toMatchObject({ score: 3, hot: true, genStatus: 'refining', reason: '粗评分为 3' })
    expect(assigned[1]?.comments.map((c) => c.text)).toEqual(['热一'])
    expect(assigned[2]).toMatchObject({ score: 3, hot: true, genStatus: 'refining' })
    expect(assigned[3]).toMatchObject({ score: 2, hot: false, genStatus: 'rough', reason: '' })
    expect(assigned[3]?.comments[0]?.displayName).toBe('考据癖')
  })

  it('treats a prediction hit as hot and says why', () => {
    const hit = { ...generated('p1', 1), prediction_hits: [{ prediction_id: 'pr_ab12c', result: '应验' }] }
    const assigned = assignOne(row(1), hit, 0)
    expect(assigned).toMatchObject({ score: 3, hot: true, genStatus: 'refining' })
    expect(assigned.reason).toContain('pr_ab12c')
  })
})

describe('jumpBlock and cold start', () => {
  it('takes the current paragraph and a few after it, stopping at generated ones', () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index + 1))
    expect(jumpBlock(rows, 3, new Set()).map((item) => item.order)).toEqual(
      Array.from({ length: JUMP_BLOCK_PARAS }, (_, index) => index + 3),
    )
    rows[4]!.genStatus = 'rough'
    expect(jumpBlock(rows, 3, new Set()).map((item) => item.order)).toEqual([3, 4])
    expect(jumpBlock(rows, 3, new Set(['p3']))).toEqual([])
  })

  it('caps the first block after entering a chapter', () => {
    const rows = Array.from({ length: 16 }, (_, index) => row(index + 1))
    expect(planNextBlock(rows, 1, new Set(), COLD_BLOCK_PARAS)).toHaveLength(COLD_BLOCK_PARAS)
  })
})

describe('bubbleFor', () => {
  it('hides empty and failed paragraphs, and marks a hot paragraph', () => {
    expect(bubbleFor('failed', 2, 0, false)).toMatchObject({ failed: true, count: 0 })
    expect(bubbleFor('failed', 2, 3, false)).toMatchObject({ count: 3, failed: false })
    expect(bubbleFor('rough', 0, 0, false)).toBeNull()
    expect(bubbleFor('none', null, 0, true)).toMatchObject({ pending: true })
    expect(bubbleFor('refined', 3, 4, false)).toEqual({
      count: 4,
      hot: true,
      pending: false,
      failed: false,
      deep: false,
    })
  })
})
