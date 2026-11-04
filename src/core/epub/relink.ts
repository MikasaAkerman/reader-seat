export interface ParagraphRef {
  id: string
  chapterHref: string
  order: number
  textHash: string
  /** 给了文本时，没对上的段按相似度在邻居之间找 */
  text?: string
}

export interface CommentRef {
  id: string
  paragraphId: string
}

export interface RelinkedComment extends CommentRef {
  mismatched: boolean
}

function bigrams(text: string): Map<string, number> {
  const compact = text.replace(/\s+/g, '')
  const out = new Map<string, number>()
  for (let i = 0; i < compact.length - 1; i++) {
    const pair = compact.slice(i, i + 2)
    out.set(pair, (out.get(pair) ?? 0) + 1)
  }
  return out
}

/** 字二元组的 Dice 系数，0 到 1。 */
export function similarity(a: string, b: string): number {
  const left = bigrams(a)
  const right = bigrams(b)
  let total = 0
  let shared = 0
  for (const count of left.values()) total += count
  for (const [pair, count] of right) {
    total += count
    shared += Math.min(count, left.get(pair) ?? 0)
  }
  return total === 0 ? 0 : (2 * shared) / total
}

const MIN_SIMILARITY = 0.3

/**
 * 新旧版本的段落对应关系：旧段 id → 新段 id。
 * 先按文本哈希精确匹配（同章、序号最近的优先）。剩下的段，在前后已对上的邻居之间的空当里找：
 * 有文本就取最像的一段（够像才算），没有文本时空当里恰好一段就认它。
 */
export function matchParagraphs(previous: ParagraphRef[], next: ParagraphRef[]): Map<string, string> {
  const matched = new Map<string, string>()
  const used = new Set<string>()
  const byHash = new Map<string, ParagraphRef[]>()
  for (const paragraph of next) {
    const list = byHash.get(paragraph.textHash) ?? []
    list.push(paragraph)
    byHash.set(paragraph.textHash, list)
  }
  const sorted = [...previous].sort((a, b) => a.chapterHref.localeCompare(b.chapterHref) || a.order - b.order)
  for (const old of sorted) {
    const candidates = (byHash.get(old.textHash) ?? []).filter((item) => !used.has(item.id))
    let best: ParagraphRef | undefined
    let bestCost = Infinity
    for (const item of candidates) {
      const cost = (item.chapterHref === old.chapterHref ? 0 : 1_000_000) + Math.abs(item.order - old.order)
      if (cost < bestCost) {
        best = item
        bestCost = cost
      }
    }
    if (!best) continue
    matched.set(old.id, best.id)
    used.add(best.id)
  }

  const nextById = new Map(next.map((item) => [item.id, item]))
  const landed = (old: ParagraphRef | undefined) => (old ? nextById.get(matched.get(old.id) ?? '') : undefined)
  const byChapter = <T extends ParagraphRef>(rows: T[]) => {
    const out = new Map<string, T[]>()
    for (const row of rows) {
      const list = out.get(row.chapterHref) ?? []
      list.push(row)
      out.set(row.chapterHref, list)
    }
    return out
  }
  const oldChapters = byChapter(sorted)
  const nextChapters = byChapter(next)
  for (const old of sorted) {
    if (matched.has(old.id)) continue
    const siblings = oldChapters.get(old.chapterHref) ?? []
    const index = siblings.indexOf(old)
    const before = siblings.slice(0, index).reverse().find((item) => matched.has(item.id))
    const after = siblings.slice(index + 1).find((item) => matched.has(item.id))
    const low = landed(before)
    const high = landed(after)
    const href = low?.chapterHref ?? high?.chapterHref ?? old.chapterHref
    const gap = (nextChapters.get(href) ?? []).filter(
      (item) =>
        !used.has(item.id) &&
        item.order > (low && low.chapterHref === href ? low.order : 0) &&
        item.order < (high && high.chapterHref === href ? high.order : Infinity),
    )
    let pick: ParagraphRef | undefined
    if (old.text !== undefined) {
      let bestScore = MIN_SIMILARITY
      for (const item of gap) {
        const score = similarity(old.text, item.text ?? '')
        if (score >= bestScore) {
          pick = item
          bestScore = score
        }
      }
    } else if (gap.length === 1) {
      pick = gap[0]
    }
    if (!pick) continue
    matched.set(old.id, pick.id)
    used.add(pick.id)
  }
  return matched
}

/** 按段落对应关系把评论指到新段落。对不上的评论标为失配，调用方不再显示。 */
export function relinkComments(matched: ReadonlyMap<string, string>, comments: CommentRef[]): RelinkedComment[] {
  return comments.map((comment) => {
    const nextParagraphId = matched.get(comment.paragraphId)
    if (!nextParagraphId) return { ...comment, mismatched: true }
    return { id: comment.id, paragraphId: nextParagraphId, mismatched: false }
  })
}
