import { describe, expect, it } from 'vitest'
import { buildPhase0Export, bumpOpens, localDateKey } from '@/core/generation/annotations'
import type { Phase0Paragraph } from '@/core/generation/phase0'

const paragraphs: Phase0Paragraph[] = [
  {
    index: 5,
    text: '他停了一下。',
    score: 3,
    comments: [
      {
        id: 'p5-t1',
        authorType: 'resident',
        displayName: '毒舌',
        text: '这句停得有点假。',
        replies: [
          {
            id: 'p5-t1-r1',
            authorType: 'passerby',
            displayName: '路过',
            text: '我也觉得。',
          },
        ],
      },
    ],
  },
]

describe('phase0 annotations', () => {
  it('counts opens by local date', () => {
    const date = new Date(2026, 10, 4)
    expect(localDateKey(date)).toBe('2026-11-04')
    expect(bumpOpens({ '2026-11-04': 2 }, date)).toEqual({ '2026-11-04': 3 })
  })

  it('exports prompt version, opens, and the comment text', () => {
    const payload = buildPhase0Export({
      promptVersion: 2,
      opensByDay: { '2026-11-04': 1 },
      marks: { 'p5-t1': '有趣', 'p5-t1-r1': '剧透' },
      paragraphs,
    })
    expect(payload.promptVersion).toBe(2)
    expect(payload.opensByDay).toEqual({ '2026-11-04': 1 })
    expect(payload.marks[0]).toEqual({
      id: 'p5-t1',
      mark: '有趣',
      text: '这句停得有点假。',
      displayName: '毒舌',
      paragraphIndex: 5,
      score: 3,
    })
    expect(payload.marks[1]?.text).toBe('我也觉得。')
  })
})
