import type { TextBlock } from '../types'

export interface OrderedText {
  order: number
  text: string
}

/** 各类任务给模型看的上下文上限（中文字数）。 */
export const CONTEXT_BUDGET = {
  roughBefore: 800,
  refineUntilHot: 2500,
  replyBefore: 2000,
  chapterTalkFull: 12_000,
  promptEntities: 80,
} as const

/** 从末尾往前取，总字数不超过 maxChars；至少保留最后一段。 */
export function tailWithin<T extends OrderedText>(rows: T[], maxChars: number): T[] {
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  const out: T[] = []
  let chars = 0
  for (let index = sorted.length - 1; index >= 0; index--) {
    const row = sorted[index]
    if (!row) continue
    if (out.length > 0 && chars + row.text.length > maxChars) break
    out.unshift(row)
    chars += row.text.length
  }
  return out
}

/** 块前面的本章上文，只给模型读，不编号，不让它评论。 */
export function precedingText<T extends OrderedText>(chapterRows: T[], firstOrder: number, maxChars: number): string {
  const before = chapterRows.filter((row) => row.order < firstOrder)
  return tailWithin(before, maxChars)
    .map((row) => row.text)
    .join('\n')
}

export function textBlockOf(rows: OrderedText[]): TextBlock {
  return { paragraphs: rows.map((row, index) => ({ index: index + 1, text: row.text })) }
}

/**
 * 已知实体里，本章到当前位置还没出现、却会在后面出现的名字。
 * 这些名字要按"首次出现"规则检查，不能当成已知。前情（摘要、梗概）里出现过的不算。
 */
export function laterNames(entities: string[], before: string, after: string, priorContext = ''): string[] {
  return entities.filter(
    (name) => name && !before.includes(name) && !priorContext.includes(name) && after.includes(name),
  )
}

/**
 * 本章说的正文。整章在上限内就全给；超了就给热段全文，其余段只给开头。
 * 编号始终是 p1..pn，和章内顺序一致。
 */
export function chapterDigest(rows: (OrderedText & { score?: number | null })[], maxChars: number): string {
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  const full = sorted.map((row, index) => `p${index + 1} ${row.text}`)
  if (full.join('\n').length <= maxChars) return full.join('\n')
  for (const opening of [60, 30, 15]) {
    const lines = sorted.map((row, index) =>
      row.score === 3 || row.text.length <= opening
        ? `p${index + 1} ${row.text}`
        : `p${index + 1} ${row.text.slice(0, opening)}…`,
    )
    const text = lines.join('\n')
    if (text.length <= maxChars) return text
  }
  return sorted
    .map((row, index) => `p${index + 1} ${row.text.slice(0, 15)}…`)
    .join('\n')
    .slice(0, maxChars)
}

/** prompt 里只列和眼前内容相关的实体；代码侧的过滤仍然用完整集合。 */
export function entitiesForPrompt(entities: string[], relevantText: string, limit: number): string[] {
  const relevant = entities.filter((name) => name && relevantText.includes(name))
  const rest = entities.filter((name) => name && !relevantText.includes(name))
  return [...relevant, ...rest.slice(-Math.max(0, limit - relevant.length))].slice(0, limit)
}
