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

export interface ReaderReply {
  id: string
  authorType: AuthorType
  displayName: string
  text: string
}

export interface ReaderThread {
  id: string
  authorType: AuthorType
  displayName: string
  role: string
  text: string
  replies: ReaderReply[]
}

export interface BubbleState {
  count: number
  hot: boolean
  pending: boolean
  failed: boolean
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
  if (status === 'failed') return { count: 0, hot: false, pending: false, failed: true }
  if ((pending || status === 'refining') && count === 0) {
    return { count: 0, hot: false, pending: true, failed: false }
  }
  if (!count || score === 0 || score == null) return null
  return { count, hot: score === 3, pending: false, failed: false }
}

export async function commentCounts(paragraphIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  if (paragraphIds.length === 0) return counts
  const comments = await db.comments.where('paragraphId').anyOf(paragraphIds).toArray()
  for (const comment of comments) {
    if (comment.mismatched) continue
    counts[comment.paragraphId] = (counts[comment.paragraphId] ?? 0) + 1
  }
  return counts
}

export async function listThreads(paragraphId: string): Promise<ReaderThread[]> {
  const batches = await db.commentBatches.where('paragraphId').equals(paragraphId).toArray()
  const batch = batches.sort((a, b) => a.batchNo - b.batchNo)[0]
  if (!batch) return []
  const comments = await db.comments.where('batchId').equals(batch.id).toArray()
  return threadsFrom(comments.filter((comment) => !comment.mismatched))
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
    replies: replies
      .filter((reply) => reply.parentId === root.id)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .map((reply) => ({
        id: reply.id,
        authorType: reply.authorType,
        displayName: reply.displayName,
        text: reply.text,
      })),
  }))
  return threads
}

function rank(authorType: AuthorType): number {
  return authorType === 'resident' ? 0 : 1
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
    if (rows.length > 0) await db.comments.bulkAdd(rows)
    await db.paragraphs.update(paragraphId, { score, genStatus })
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

export async function readMemory(bookId: string): Promise<{ memory: BookMemory; entities: string[] }> {
  const row = await db.bookMemories.get(bookId)
  if (!row) return { memory: emptyMemory(bookId), entities: [] }
  return {
    memory: {
      bookId,
      nicknames: row.nicknames ?? [],
      predictions: row.predictions ?? [],
      debates: row.debates ?? [],
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
    entities,
    updatedAt: memory.updatedAt,
  }
  await db.bookMemories.put(row)
}

export async function writeGenerationLog(entry: Omit<GenerationLogRow, 'id' | 'createdAt'>): Promise<void> {
  await db.generationLogs.add({
    ...entry,
    id: createId(),
    createdAt: nowIso(),
  })
}
