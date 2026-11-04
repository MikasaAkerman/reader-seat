import { describe, expect, it } from 'vitest'
import {
  chapterDigest,
  entitiesForPrompt,
  laterNames,
  precedingText,
  tailWithin,
} from '@/core/generation/context'

const rows = (texts: string[]) => texts.map((text, index) => ({ order: index + 1, text }))

describe('context budgets', () => {
  it('takes the tail within the budget but always keeps the last paragraph', () => {
    const chapter = rows(['一'.repeat(500), '二'.repeat(500), '三'.repeat(500)])
    expect(tailWithin(chapter, 1000).map((row) => row.order)).toEqual([2, 3])
    expect(tailWithin(chapter, 10).map((row) => row.order)).toEqual([3])
  })

  it('gives rough only the text before the block, within its budget', () => {
    const chapter = rows(['开头', '中间', '块的第一段', '块的第二段'])
    expect(precedingText(chapter, 3, 800)).toBe('开头\n中间')
    expect(precedingText(chapter, 1, 800)).toBe('')
    expect(precedingText(chapter, 3, 2)).toBe('中间')
  })

  it('flags names that only appear later in the chapter, unless the prior context has them', () => {
    const entities = ['老周', '阿梅', '巷口']
    expect(laterNames(entities, '巷口很黑', '老周来了，阿梅也来了')).toEqual(['老周', '阿梅'])
    expect(laterNames(entities, '巷口很黑', '老周来了', '前情：老周离家')).toEqual([])
  })

  it('sends the whole chapter when it fits, otherwise hot paragraphs in full and openings for the rest', () => {
    const chapter = [
      { order: 1, text: '甲'.repeat(100), score: 1 },
      { order: 2, text: '乙'.repeat(100), score: 3 },
      { order: 3, text: '丙'.repeat(100), score: 0 },
    ]
    expect(chapterDigest(chapter, 1000)).toBe(chapter.map((row, i) => `p${i + 1} ${row.text}`).join('\n'))
    const digest = chapterDigest(chapter, 250)
    expect(digest.length).toBeLessThanOrEqual(250)
    expect(digest).toContain(`p2 ${'乙'.repeat(100)}`)
    expect(digest).toContain(`p1 ${'甲'.repeat(60)}…`)
    expect(digest.split('\n')).toHaveLength(3)
  })

  it('lists relevant entities first and caps the rest', () => {
    const entities = Array.from({ length: 100 }, (_, index) => `人${index}`)
    const picked = entitiesForPrompt(entities, '人5 和 人7 在巷口', 10)
    expect(picked).toHaveLength(10)
    expect(picked.slice(0, 2)).toEqual(['人5', '人7'])
    expect(picked).toContain('人99')
  })
})
