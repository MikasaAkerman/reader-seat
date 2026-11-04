export interface AnchorRef {
  id: string
  anchor: string
}

export interface CommentRef {
  id: string
  paragraphId: string
}

export interface RelinkedComment extends CommentRef {
  mismatched: boolean
}

/**
 * 同一书名、指纹不同时，按锚点把评论指到新段落。
 * 对不上的评论标为失配，调用方不再显示。
 */
export function relinkComments(
  previous: AnchorRef[],
  next: AnchorRef[],
  comments: CommentRef[],
): RelinkedComment[] {
  const previousAnchor = new Map(previous.map((paragraph) => [paragraph.id, paragraph.anchor]))
  const nextId = new Map(next.map((paragraph) => [paragraph.anchor, paragraph.id]))
  return comments.map((comment) => {
    const anchor = previousAnchor.get(comment.paragraphId)
    const nextParagraphId = anchor ? nextId.get(anchor) : undefined
    if (!nextParagraphId) return { ...comment, mismatched: true }
    return { id: comment.id, paragraphId: nextParagraphId, mismatched: false }
  })
}
