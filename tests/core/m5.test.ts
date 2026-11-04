import { describe, expect, it } from 'vitest'
import { canReroll, latestBatch, nextBatchNo, rerollsOnDay } from '@/core/comments/batches'
import { summarizeCosts } from '@/core/cost/summary'
import { buildReadingMarkdown, paragraphOpening } from '@/core/export/markdown'
import { chapterTalkResultSchema } from '@/core/generation/schema'
import { commentPasses } from '@/core/generation/spoiler'
import { commentsHidden, paragraphLocked } from '@/core/reading/unlock'

describe('chapter talk schema', () => {
  it('keeps a summary when the new arrays are missing', () => {
    const parsed = chapterTalkResultSchema.parse({ summary: '这一章很短' })
    expect(parsed.summary).toBe('这一章很短')
    expect(parsed.hot_paragraphs).toEqual([])
    expect(parsed.resident_lines).toEqual([])
    expect(parsed.debates).toEqual([])
    expect(parsed.prediction_updates).toEqual([])
    expect(parsed.memory_updates.nicknames).toEqual([])
    expect(parsed.memory_updates.scenes).toEqual([])
  })

  it('keeps the summary when a talk line is not an object', () => {
    const parsed = chapterTalkResultSchema.parse({
      summary: '灯灭了',
      hot_paragraphs: ['p2', 3],
      resident_lines: ['一句话', { reader_role: '毒舌', text: '太突然' }],
      memory_updates: { nicknames: '不是数组' },
    })
    expect(parsed.summary).toBe('灯灭了')
    expect(parsed.hot_paragraphs).toEqual(['p2'])
    expect(parsed.resident_lines).toEqual([{ reader_role: '毒舌', text: '太突然' }])
    expect(parsed.memory_updates.nicknames).toEqual([])
  })
})

describe('unlock', () => {
  it('hides a chapter until it is finished and reviewed', () => {
    expect(commentsHidden('关闭', false, false)).toBe(false)
    expect(commentsHidden('逐段先写后看', false, false)).toBe(false)
    expect(commentsHidden('章末解锁', false, true)).toBe(true)
    expect(commentsHidden('章末解锁', true, false)).toBe(true)
    expect(commentsHidden('章末解锁', true, true)).toBe(false)
  })

  it('locks a paragraph until the reader has written on it', () => {
    expect(paragraphLocked('逐段先写后看', false)).toBe(true)
    expect(paragraphLocked('逐段先写后看', true)).toBe(false)
    expect(paragraphLocked('关闭', false)).toBe(false)
    expect(paragraphLocked('章末解锁', false)).toBe(false)
  })
})

describe('comment batches', () => {
  const day = new Date(2026, 10, 4, 12)

  it('shows the latest batch and counts only later batches toward the daily cap', () => {
    const batches = [
      { batchNo: 1, createdAt: '2026-11-04T01:00:00' },
      { batchNo: 3, createdAt: '2026-11-04T02:00:00' },
      { batchNo: 2, createdAt: '2026-11-03T03:00:00' },
    ]
    expect(latestBatch(batches)?.batchNo).toBe(3)
    expect(rerollsOnDay(batches, '2026-11-04')).toBe(1)
    expect(canReroll(batches, day)).toBe(true)
    expect(nextBatchNo(batches)).toBe(4)
  })

  it('stops after three new batches on the same local day', () => {
    const batches = [1, 2, 3, 4].map((batchNo) => ({
      batchNo,
      createdAt: '2026-11-04T08:00:00',
    }))
    expect(rerollsOnDay(batches, '2026-11-04')).toBe(3)
    expect(canReroll(batches, day)).toBe(false)
  })
})

describe('spoiler filter', () => {
  it('drops a failed comment and keeps one the checker did not mention', () => {
    const results = [
      { id: 'r0', pass: false },
      { id: 'r1', pass: true },
    ]
    expect(commentPasses('r0', results)).toBe(false)
    expect(commentPasses('r1', results)).toBe(true)
    expect(commentPasses('r2', results)).toBe(true)
  })
})

describe('reading markdown', () => {
  const chapter = {
    title: '灯',
    notes: [{ opening: '灯灭了。', text: '这里暗' }],
    comments: [{ text: '我觉得他在等', replies: ['毒舌：等什么'] }],
    micro: { judgment: '他回头了', evidence: '最后一句', reservation: '也许只是风' },
  }

  it('keeps a short locator and leaves replies out unless asked', () => {
    const opening = paragraphOpening('灯 灭了。他在巷口站住，看了很久很久才离开，雨也停了')
    expect(opening).toBe('灯灭了。他在巷口站住，看了很久很久才离开')
    expect(opening.length).toBeLessThanOrEqual(20)
    const quiet = buildReadingMarkdown({
      title: '巷口的灯',
      translator: '无',
      station: 1,
      exportedAt: '2026-11-04',
      chapters: [chapter],
      includeReplies: false,
    })
    expect(quiet).toContain('book: 巷口的灯')
    expect(quiet).toContain('translator: 无')
    expect(quiet).toContain('station: 1')
    expect(quiet).toContain('exported: 2026-11-04')
    expect(quiet).toContain('「灯灭了。」：这里暗')
    expect(quiet).toContain('我觉得他在等')
    expect(quiet).toContain('判断：他回头了')
    expect(quiet).not.toContain('毒舌')
    const spoken = buildReadingMarkdown({
      title: '巷口的灯',
      translator: '无',
      station: null,
      exportedAt: '2026-11-04',
      chapters: [chapter],
      includeReplies: true,
    })
    expect(spoken).toContain('毒舌：等什么')
  })
})

describe('cost summary', () => {
  it('groups calls by book and local day', () => {
    const summary = summarizeCosts(
      [
        {
          bookId: 'a',
          createdAt: '2026-11-04T08:00:00',
          promptTokens: 100,
          completionTokens: 20,
          cacheHitTokens: 40,
          cost: 0.2,
          latencyMs: 1000,
        },
        {
          bookId: 'a',
          createdAt: '2026-11-03T08:00:00',
          promptTokens: 50,
          completionTokens: 10,
          cacheHitTokens: 0,
          cost: 0.1,
        },
        {
          bookId: 'b',
          createdAt: '2026-11-04T09:00:00',
          promptTokens: 0,
          completionTokens: 0,
          cacheHitTokens: 0,
          cost: 0,
        },
      ],
      { a: '巷口的灯' },
    )
    expect(summary.books.map((book) => book.title)).toEqual(['巷口的灯', '未命名'])
    expect(summary.books[0]).toMatchObject({
      calls: 2,
      promptTokens: 150,
      completionTokens: 30,
      latencyMs: 1000,
    })
    expect(summary.books[0]?.cost).toBeCloseTo(0.3)
    expect(summary.books[0]?.cacheHitRate).toBeCloseTo(40 / 150)
    expect(summary.books[1]?.latencyMs).toBeNull()
    expect(summary.days.map((day) => day.day)).toEqual(['2026-11-04', '2026-11-03'])
    expect(summary.days[0]).toMatchObject({ calls: 2, cost: 0.2 })
  })
})
