import { DEFAULT_LINEUP } from '../personas'
import type { AuthorType, ResidentPersona, TextBlock } from '../types'
import { planBlocks } from './blocks'
import type { RoughParagraph } from './schema'

export const BUFFER_LOW = 8
export const BUFFER_TARGET = 15
export const HOT_LIMIT = 2
/** 进入章节或跳读后的第一块，先小一点，让眼前几段尽快有反应。 */
export const COLD_BLOCK_PARAS = 5
/** 跳读时，当前段加后面几段。 */
export const JUMP_BLOCK_PARAS = 4

export type PipelineStatus = 'none' | 'rough' | 'refining' | 'refined' | 'failed'

export interface PipelineRow {
  id: string
  order: number
  text: string
  kind: 'heading' | 'body'
  genStatus: PipelineStatus
}

export interface PipelineComment {
  authorType: AuthorType
  displayName: string
  role: string
  text: string
}

export function lineupFor(spoilerLevel: string, enabled: Record<string, boolean> = {}): ResidentPersona[] {
  return DEFAULT_LINEUP.filter((persona) => {
    if (enabled[persona.role] === false) return false
    if (spoilerLevel === '严格' && persona.role === '老书虫') return false
    return true
  })
}

export function planNextBlock<T extends PipelineRow>(
  rows: T[],
  fromOrder: number,
  skip: ReadonlySet<string> = new Set(),
  maxParagraphs?: number,
): T[] | null {
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  const start = sorted.findIndex(
    (row) => row.order >= fromOrder && row.genStatus === 'none' && !skip.has(row.id),
  )
  if (start < 0) return null
  const contiguous: T[] = []
  for (const row of sorted.slice(start)) {
    if (row.genStatus !== 'none' || skip.has(row.id)) break
    contiguous.push(row)
  }
  const first = planBlocks(contiguous.map((row) => row.text))[0]
  if (!first) return null
  const size = maxParagraphs ? Math.min(maxParagraphs, first.paragraphs.length) : first.paragraphs.length
  return contiguous.slice(0, size)
}

export function readyAhead<T extends PipelineRow>(
  rows: T[],
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

export function blockIndex<T extends PipelineRow>(rows: T[], order: number): number {
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

/** 跳读后要立刻生成的一小块：当前段和后面几段里还没生成的。 */
export function jumpBlock<T extends PipelineRow>(rows: T[], order: number, skip: ReadonlySet<string>): T[] {
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  const out: T[] = []
  for (const row of sorted) {
    if (row.order < order) continue
    if (row.genStatus !== 'none' || skip.has(row.id)) break
    out.push(row)
    if (out.length >= JUMP_BLOCK_PARAS) break
  }
  return out
}

export function toTextBlock(rows: { text: string }[]): TextBlock {
  return { paragraphs: rows.map((row, index) => ({ index: index + 1, text: row.text })) }
}

export interface AssignedParagraph<T extends PipelineRow = PipelineRow> {
  row: T
  score: number
  hot: boolean
  genStatus: 'rough' | 'refining'
  comments: PipelineComment[]
  /** 精修时告诉模型这段为什么热 */
  reason: string
}

/**
 * 标题段记 0 分。命中预测的段按热段处理。热段名额用完的降为 2 分，保留粗评。
 * 热段也先存粗评里的那条短评，精修回来再替换。
 */
export function assignOne<T extends PipelineRow>(
  row: T,
  found: RoughParagraph | undefined,
  hotSoFar: number,
): AssignedParagraph<T> {
  if (row.kind === 'heading') {
    return { row, score: 0, hot: false, genStatus: 'rough', comments: [], reason: '' }
  }
  const hits = found?.prediction_hits ?? []
  let score: number = hits.length > 0 ? 3 : (found?.score ?? 0)
  let hot = false
  if (score === 3) {
    if (hotSoFar < HOT_LIMIT) hot = true
    else score = 2
  }
  const reason = hits.length > 0
    ? `命中预测：${hits.map((hit) => `${hit.prediction_id}（${hit.result}）`).join('；')}`
    : '粗评分为 3'
  return {
    row,
    score,
    hot,
    genStatus: hot ? 'refining' : 'rough',
    comments: (found?.comments ?? []).map(toStored),
    reason: hot ? reason : '',
  }
}

export function assignGeneration<T extends PipelineRow>(rows: T[], generated: RoughParagraph[]): AssignedParagraph<T>[] {
  let hot = 0
  return rows.map((row, index) => {
    const assigned = assignOne(row, generated.find((item) => item.pid === `p${index + 1}`), hot)
    if (assigned.hot) hot += 1
    return assigned
  })
}

function toStored(comment: RoughParagraph['comments'][number]): PipelineComment {
  const resident = comment.author_type === 'resident'
  return {
    authorType: comment.author_type,
    displayName: resident ? comment.reader_role || comment.display_name || '书友' : comment.display_name || '路人',
    role: comment.reader_role || '',
    text: comment.text,
  }
}
