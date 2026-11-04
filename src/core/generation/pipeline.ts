import type { ParagraphRow } from '@/db/schema'
import type { StoredComment } from '@/db/repos/comments'
import { DEFAULT_LINEUP } from '../personas'
import type { ResidentPersona, TextBlock } from '../types'
import { planBlocks } from './blocks'
import type { RoughParagraph } from './schema'

export const BUFFER_LOW = 8
export const BUFFER_TARGET = 15

export function lineupFor(spoilerLevel: string, enabled: Record<string, boolean> = {}): ResidentPersona[] {
  return DEFAULT_LINEUP.filter((persona) => {
    if (enabled[persona.role] === false) return false
    if (spoilerLevel === '严格' && persona.role === '老书虫') return false
    return true
  })
}

export function planNextBlock(
  rows: ParagraphRow[],
  fromOrder: number,
  skip: ReadonlySet<string> = new Set(),
): ParagraphRow[] | null {
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  const start = sorted.findIndex(
    (row) => row.order >= fromOrder && row.genStatus === 'none' && !skip.has(row.id),
  )
  if (start < 0) return null
  const contiguous: ParagraphRow[] = []
  for (const row of sorted.slice(start)) {
    if (row.genStatus !== 'none' || skip.has(row.id)) break
    contiguous.push(row)
  }
  const first = planBlocks(contiguous.map((row) => row.text))[0]
  if (!first) return null
  return contiguous.slice(0, first.paragraphs.length)
}

export function readyAhead(
  rows: ParagraphRow[],
  fromOrder: number,
  skip: ReadonlySet<string> = new Set(),
): number {
  let count = 0
  for (const row of [...rows].sort((a, b) => a.order - b.order)) {
    if (row.order < fromOrder) continue
    if (row.genStatus === 'none' && skip.has(row.id)) {
      count += 1
      continue
    }
    if (row.genStatus === 'none') break
    if (row.genStatus === 'failed') continue
    count += 1
  }
  return count
}

export function blockIndex(rows: ParagraphRow[], order: number): number {
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  const blocks = planBlocks(sorted.map((row) => row.text))
  let consumed = 0
  for (let index = 0; index < blocks.length; index++) {
    consumed += blocks[index]?.paragraphs.length ?? 0
    const last = sorted[consumed - 1]
    if (last && last.order >= order) return index
  }
  return 0
}

export function toTextBlock(rows: ParagraphRow[]): TextBlock {
  return { paragraphs: rows.map((row, index) => ({ index: index + 1, text: row.text })) }
}

export interface AssignedParagraph {
  row: ParagraphRow
  score: number
  hot: boolean
  genStatus: 'rough' | 'refining'
  comments: StoredComment[]
}

/** 标题段记 0 分。一块里最多留下 2 个热段。 */
export function assignGeneration(rows: ParagraphRow[], generated: RoughParagraph[]): AssignedParagraph[] {
  let hot = 0
  return rows.map((row, index) => {
    const found = generated.find((item) => item.pid === `p${index + 1}`)
    if (row.kind === 'heading') {
      return { row, score: 0, hot: false, genStatus: 'rough', comments: [] }
    }
    let score = found?.score ?? 0
    let isHot = false
    if (score === 3) {
      if (hot < 2) {
        hot += 1
        isHot = true
      } else {
        score = 2
      }
    }
    return {
      row,
      score,
      hot: isHot,
      genStatus: isHot ? 'refining' : 'rough',
      comments: isHot ? [] : (found?.comments ?? []).map(toStored),
    }
  })
}

function toStored(comment: RoughParagraph['comments'][number]): StoredComment {
  const resident = comment.author_type === 'resident'
  return {
    authorType: comment.author_type,
    displayName: resident ? comment.reader_role || comment.display_name || '书友' : comment.display_name || '路人',
    role: comment.reader_role || '',
    text: comment.text,
  }
}
