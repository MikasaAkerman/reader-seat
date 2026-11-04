import type { BlockText, GeneratedComment } from '../types'

/**
 * 已知实体（本块之前已出现）允许出现在任意段。
 * newEntities 里、且不在已知表中的名字，按块内首次出现的段落限制：
 * 评论所在段早于首次出现，或块内根本没出现，就丢弃这条评论。
 */
export function filterByEntityRule(
  comments: GeneratedComment[],
  block: BlockText,
  knownEntities: Set<string>,
  newEntities: string[] = [],
): GeneratedComment[] {
  const watched = newEntities.filter((name) => name && !knownEntities.has(name))
  const firstAt = new Map<string, number | null>()
  for (const name of watched) {
    const found = block.paragraphs.find((p) => p.text.includes(name))
    firstAt.set(name, found ? found.index : null)
  }

  return comments.filter((comment) => {
    for (const name of watched) {
      if (!comment.text.includes(name)) continue
      const at = firstAt.get(name)
      if (at === null || at === undefined || at > comment.paragraphIndex) return false
    }
    return true
  })
}
