import { describe, expect, it } from 'vitest'
import { filterByEntityRule } from '@/core/generation/entities'
import type { BlockText, GeneratedComment } from '@/core/types'

const block: BlockText = {
  paragraphs: [
    { index: 1, text: '街上只有风。' },
    { index: 2, text: '阿明从巷口走出来。' },
  ],
}

describe('filterByEntityRule', () => {
  it('drops a comment that names an entity before it appears', () => {
    const comments: GeneratedComment[] = [{ paragraphIndex: 1, text: '阿明这是要去哪' }]
    expect(filterByEntityRule(comments, block, new Set(), ['阿明'])).toEqual([])
  })

  it('keeps a comment that names an already-known entity', () => {
    const comments: GeneratedComment[] = [{ paragraphIndex: 1, text: '阿明怎么还没出现' }]
    expect(filterByEntityRule(comments, block, new Set(['阿明']), ['阿明'])).toEqual(comments)
  })

  it('keeps a comment that names no tracked entity', () => {
    const comments: GeneratedComment[] = [{ paragraphIndex: 1, text: '这风真大' }]
    expect(filterByEntityRule(comments, block, new Set(), ['阿明'])).toEqual(comments)
  })
})
