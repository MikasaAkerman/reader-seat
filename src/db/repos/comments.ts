import { latestBatch } from '@/core/comments/batches'
import { emptyMemory } from '@/core/memory'
import type { AuthorType, BookMemory } from '@/core/types'
import { createId } from '../id'
import {
  db,
  type BookMemoryRow,
  type CommentRow,
  type GenStatus,
  type GenerationLogRow,
} from '../schema'

export interface StoredComment {
  authorType: AuthorType
  displayName: string
  role: string
  text: string
  replies?: StoredComment[]
}

export interface CommentMarks {
  saved: boolean
  boring: boolean
  spoiler: boolean
  wrong: boolean
}

export interface ReaderReply {
  id: string
  authorType: AuthorType
  displayName: string
  role: string
  text: string
  marks: CommentMarks
}

export interface ReaderThread {
  id: string
  authorType: AuthorType
  displayName: string
  role: string
  text: string
  marks: CommentMarks
  replies: ReaderReply[]
}

export interface BubbleState {
  count: number
  hot: boolean
  pending: boolean
  failed: boolean
  locked?: boolean
}

function nowIso(): string {
  return new Date().toISOString()
}

export function bubbleFor(
  status: GenStatus | undefined,
  score: number | null | undefined,
  count: number,
  pending: boolean,
): BubbleState | null {
  if (status === 'failed' && count === 0) return { count: 0, hot: false, pending: false, failed: true }
  if ((pending || status === 'refining') && count === 0) {
    return { count: 0, hot: false, pending: true, failed: false }
  }
  if (!count) return null
  return { count, hot: score === 3, pending: false, failed: false }
}

export async function commentCounts(paragraphIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  if (paragraphIds.length === 0) return counts
  const batches = await db.commentBatches.where('paragraphId').anyOf(paragraphIds).toArray()
  const chosen = new Map<string, string>()
  const grouped = new Map<string, typeof batches>()
  for (const batch of batches) {
    const list = grouped.get(batch.paragraphId) ?? []
    list.push(batch)
    grouped.set(batch.paragraphId, list)
  }
  for (const [paragraphId, list] of grouped) {
    const batch = latestBatch(list)
    if (batch) chosen.set(paragraphId, batch.id)
  }
  const ids = [...chosen.values()]
  if (ids.length === 0) return counts
  const comments = await db.comments.where('batchId').anyOf(ids).toArray()
  for (const comment of comments) {
    if (comment.mismatched || comment.spoiler) continue
    counts[comment.paragraphId] = (counts[comment.paragraphId] ?? 0) + 1
  }
  return counts
}

export async function listThreads(paragraphId: string, batchNo?: number): Promise<ReaderThread[]> {
  const batches = await db.commentBatches.where('paragraphId').equals(paragraphId).toArray()
  const batch =
    batchNo === undefined ? latestBatch(batches) : batches.find((item) => item.batchNo === batchNo)
  if (!batch) return []
  const comments = await db.comments.where('batchId').equals(batch.id).toArray()
  return threadsFrom(comments.filter((comment) => !comment.mismatched && !comment.spoiler))
}

export async function listBatches(paragraphId: string) {
  return db.commentBatches.where('paragraphId').equals(paragraphId).toArray()
}

export async function commentsInBatch(batchId: string) {
  return db.comments.where('batchId').equals(batchId).toArray()
}

export async function shortReaction(paragraphId: string): Promise<{ text: string } | null> {
  const threads = await listThreads(paragraphId)
  const line = threads.find((thread) => thread.authorType !== 'user' && thread.text.trim())
  if (!line) return null
  return { text: line.text.slice(0, 40) }
}

export function threadsFrom(comments: CommentRow[]): ReaderThread[] {
  const roots = comments
    .filter((comment) => !comment.parentId)
    .sort((a, b) => rank(a.authorType) - rank(b.authorType) || (a.seq ?? 0) - (b.seq ?? 0))
  const replies = comments.filter((comment) => comment.parentId)
  const threads = roots.map((root) => ({
    id: root.id,
    authorType: root.authorType,
    displayName: root.displayName,
    role: root.role,
    text: root.text,
    marks: marksOf(root),
    replies: replies
      .filter((reply) => reply.parentId === root.id)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .map((reply) => ({
        id: reply.id,
        authorType: reply.authorType,
        displayName: reply.displayName,
        role: reply.role,
        text: reply.text,
        marks: marksOf(reply),
      })),
  }))
  return threads
}

function marksOf(comment: CommentRow): CommentMarks {
  return {
    saved: comment.saved === true,
    boring: comment.boring === true,
    spoiler: comment.spoiler === true,
    wrong: comment.wrong === true,
  }
}

export async function appendComment(
  paragraphId: string,
  comment: StoredComment,
  parentId = '',
): Promise<string> {
  const existing = await db.commentBatches.where({ paragraphId, batchNo: 1 }).first()
  const batchId = existing?.id ?? createId()
  const current = existing ? await db.comments.where('batchId').equals(batchId).toArray() : []
  const seq = current.reduce((max, row) => Math.max(max, row.seq ?? 0), -1) + 1
  const id = createId()
  await db.transaction('rw', [db.commentBatches, db.comments], async () => {
    if (!existing) {
      await db.commentBatches.add({ id: batchId, paragraphId, batchNo: 1, createdAt: nowIso() })
    }
    await db.comments.add(toRow(paragraphId, batchId, id, parentId, comment, seq))
  })
  return id
}

export async function setCommentMark(
  commentId: string,
  mark: keyof CommentMarks,
  on: boolean,
): Promise<void> {
  await db.comments.update(commentId, { [mark]: on })
}

export async function tasteExamplesFor(bookId: string): Promise<string> {
  const paragraphs = await db.paragraphs.where('bookId').equals(bookId).toArray()
  if (paragraphs.length === 0) return ''
  const comments = await db.comments.where('paragraphId').anyOf(paragraphs.map((row) => row.id)).toArray()
  const line = (comment: CommentRow, label: string) => `${label}：${comment.text.slice(0, 50)}`
  const marked = paragraphs
    .filter((paragraph) => paragraph.userMarked === 'interesting')
    .slice(0, 3)
    .map((paragraph) => `想再看到：${paragraph.text.slice(0, 50)}`)
  const positive = comments.filter((comment) => comment.saved).slice(0, 3).map((comment) => line(comment, '想再看到'))
  const negative = comments
    .filter((comment) => comment.boring || comment.spoiler || comment.wrong)
    .slice(0, 3)
    .map((comment) => line(comment, '不要这样'))
  return [...marked, ...positive, ...negative].join('\n')
}

function rank(authorType: AuthorType): number {
  if (authorType === 'user') return 0
  if (authorType === 'resident') return 1
  return 2
}

/** 同一段只保留第 1 批。再次写入会替换这一批，而不是另开一批。 */
export async function saveParagraphComments(
  paragraphId: string,
  comments: StoredComment[],
  score: number,
  genStatus: GenStatus,
): Promise<void> {
  const existing = await db.commentBatches.where({ paragraphId, batchNo: 1 }).first()
  const batchId = existing?.id ?? createId()
  const rows: CommentRow[] = []
  let seq = 0
  for (const comment of comments) {
    const id = createId()
    rows.push(toRow(paragraphId, batchId, id, '', comment, seq))
    seq += 1
    for (const reply of comment.replies ?? []) {
      rows.push(toRow(paragraphId, batchId, createId(), id, reply, seq))
      seq += 1
    }
  }
  await db.transaction('rw', [db.commentBatches, db.comments, db.paragraphs], async () => {
    const kept = existing
      ? (await db.comments.where('batchId').equals(batchId).toArray()).filter(
          (row) => row.authorType === 'user' && !row.parentId,
        )
      : []
    if (!existing) {
      await db.commentBatches.add({
        id: batchId,
        paragraphId,
        batchNo: 1,
        createdAt: nowIso(),
      })
    } else {
      await db.comments.where('batchId').equals(batchId).delete()
    }
    const keptRows = kept.map((row) => ({ ...row, batchId }))
    const writing = [...rows, ...keptRows]
    if (writing.length > 0) await db.comments.bulkAdd(writing)
    await db.paragraphs.update(paragraphId, { score, genStatus })
  })
}

export async function saveNextBatch(
  paragraphId: string,
  batchNo: number,
  comments: CommentRow[],
): Promise<void> {
  const batchId = createId()
  const idMap = new Map<string, string>()
  for (const comment of comments) idMap.set(comment.id, createId())
  const rows = comments.map((comment) => ({
    ...comment,
    id: idMap.get(comment.id) ?? createId(),
    batchId,
    paragraphId,
    parentId: comment.parentId && idMap.has(comment.parentId) ? idMap.get(comment.parentId)! : '',
  }))
  await db.transaction('rw', [db.commentBatches, db.comments], async () => {
    await db.commentBatches.add({ id: batchId, paragraphId, batchNo, createdAt: nowIso() })
    if (rows.length > 0) await db.comments.bulkAdd(rows)
  })
}

function toRow(
  paragraphId: string,
  batchId: string,
  id: string,
  parentId: string,
  comment: StoredComment,
  seq: number,
): CommentRow {
  return {
    id,
    batchId,
    paragraphId,
    parentId,
    authorType: comment.authorType,
    displayName: comment.displayName,
    role: comment.role,
    text: comment.text,
    seq,
  }
}

export async function markParagraph(paragraphId: string, genStatus: GenStatus, score?: number | null): Promise<void> {
  await db.paragraphs.update(paragraphId, score === undefined ? { genStatus } : { genStatus, score })
}

export async function markUserInterest(paragraphId: string): Promise<void> {
  await db.paragraphs.update(paragraphId, { userMarked: 'interesting' })
}

export async function readMemory(bookId: string): Promise<{ memory: BookMemory; entities: string[] }> {
  const row = await db.bookMemories.get(bookId)
  if (!row) return { memory: emptyMemory(bookId), entities: [] }
  return {
    memory: {
      bookId,
      nicknames: row.nicknames ?? [],
      predictions: row.predictions ?? [],
      debates: row.debates ?? [],
      scenes: row.scenes ?? [],
      stances: row.stances ?? [],
      userStance: row.userStance ?? [],
      updatedAt: row.updatedAt,
    },
    entities: row.entities ?? [],
  }
}

export async function writeMemory(memory: BookMemory, entities: string[]): Promise<void> {
  const row: BookMemoryRow = {
    bookId: memory.bookId,
    nicknames: memory.nicknames,
    predictions: memory.predictions,
    debates: memory.debates,
    scenes: memory.scenes,
    stances: memory.stances,
    userStance: memory.userStance,
    entities,
    updatedAt: memory.updatedAt,
  }
  await db.bookMemories.put(JSON.parse(JSON.stringify(row)) as BookMemoryRow)
}

export async function writeGenerationLog(entry: Omit<GenerationLogRow, 'id' | 'createdAt'>): Promise<void> {
  await db.generationLogs.add({
    ...entry,
    id: createId(),
    createdAt: nowIso(),
  })
}
