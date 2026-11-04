import { describe, expect, it } from 'vitest'
import { planBlocks, splitParagraphs } from '@/core/generation/blocks'

describe('blocks', () => {
  it('splits on blank lines', () => {
    expect(splitParagraphs('甲\n\n乙\n\n\n丙')).toEqual(['甲', '乙', '丙'])
  })

  it('closes a block at 1500 characters', () => {
    const paragraphs = ['甲'.repeat(800), '乙'.repeat(800), '丙']
    const blocks = planBlocks(paragraphs)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.paragraphs).toHaveLength(2)
    expect(blocks[1]?.paragraphs.map((p) => p.index)).toEqual([1])
  })
})
