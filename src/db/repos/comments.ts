import { latestBatch, rootsWithUserReplies } from '@/core/comments/batches'
import { emptyMemory } from '@/core/memory'
import type { AuthorType, BookMemory } from '@/core/types'
import { createId } from '../id'
import type { CommentKind } from '../schema'
import {
  db,
  type BookMemoryRow,
  type CommentEvidence,
  type CommentRow,
  type DeepSpotRow,
  type DroppedLog,
  type GenStatus,
  type GenerationLogRow,
  type ObservationRow,
} from '../schema'

/** 用户主楼和它下面的回复都放在这里，不属于任何一批。 */
export const USER_ZONE = ''

export interface StoredComment {
  authorType: AuthorType
  displayName: string
  role: string
  text: string
  kind?: CommentKind
  title?: string
  evidence?: CommentEvidence[]
  background?: string
  question?: string
  replyType?: string
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
  kind?: CommentKind
  marks: CommentMarks
}

export interface ReaderThread {
  id: string
  authorType: AuthorType
  displayName: string
  role: string
  text: string
  kind?: CommentKind
  title?: string
  evidence?: CommentEvidence[]
  background?: string
  question?: string
  marks: CommentMarks
  replies: ReaderReply[]
}

export interface BubbleState {
  count: number
  hot: boolean
  pending: boolean
  failed: boolean
  locked?: boolean
  deep?: boolean
}

export interface MemoryState {
  memory: BookMemory
  entities: string[]
  /** 全书滚动梗概 */
  synopsis: string
  /** 梗概覆盖到的章节 order，-1 表示还没有 */
  synopsisThrough: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function visible(comment: CommentRow): boolean {
  return !comment.mismatched && !comment.spoiler
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
  return { count, hot: score === 3, pending: false, failed: false, deep: false }
}

export async function deepParagraphIds(paragraphIds: string[]): Promise<Set<string>> {
  if (paragraphIds.length === 0) return new Set()
  const comments = await db.comments.where('paragraphId').anyOf(paragraphIds).toArray()
  return new Set(
    comments.filter((comment) => comment.kind === 'deep' && !comment.parentId && visible(comment)).map((comment) => comment.paragraphId),
  )
}

/** 每段显示的条数：最新一批，加上用户区。 */
export async function commentCounts(paragraphIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  if (paragraphIds.length === 0) return counts
  const batches = await db.commentBatches.where('paragraphId').anyOf(paragraphIds).toArray()
  const grouped = new Map<string, typeof batches>()
  for (const batch of batches) {
    const list = grouped.get(batch.paragraphId) ?? []
    list.push(batch)
    grouped.set(batch.paragraphId, list)
  }
  const shown = new Set<string>([USER_ZONE])
  for (const list of grouped.values()) {
    const batch = latestBatch(list)
    if (batch) shown.add(batch.id)
  }
  const comments = await db.comments.where('paragraphId').anyOf(paragraphIds).toArray()
  for (const comment of comments) {
    if (!shown.has(comment.batchId) || !visible(comment)) continue
    counts[comment.paragraphId] = (counts[comment.paragraphId] ?? 0) + 1
  }
  return counts
}

export async function listThreads(paragraphId: string, batchNo?: number): Promise<ReaderThread[]> {
  const batches = await db.commentBatches.where('paragraphId').equals(paragraphId).toArray()
  const batch =
    batchNo === undefined ? latestBatch(batches) : batches.find((item) => item.batchNo === batchNo)
  const rows = await db.comments.where('paragraphId').equals(paragraphId).toArray()
  const chosen = rows.filter((row) => row.batchId === USER_ZONE || (batch && row.batchId === batch.id))
  return threadsFrom(chosen.filter(visible))
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
    .sort((a, b) => rank(a) - rank(b) || (a.seq ?? 0) - (b.seq ?? 0))
  const replies = comments.filter((comment) => comment.parentId)
  const threads = roots.map((root) => ({
    id: root.id,
    authorType: root.authorType,
    displayName: root.displayName,
    role: root.role,
    text: root.text,
    kind: root.kind,
    title: root.title,
    evidence: root.evidence,
    background: root.background,
    question: root.question,
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
        kind: reply.kind,
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

/**
 * 用户主楼进用户区；回复跟着主楼所在的批，这样换批前后都看得到。
 */
export async function appendComment(
  paragraphId: string,
  comment: StoredComment,
  parentId = '',
): Promise<string> {
  const id = createId()
  await db.transaction('rw', [db.comments], async () => {
    const parent = parentId ? await db.comments.get(parentId) : undefined
    const batchId = parent ? parent.batchId : USER_ZONE
    const siblings = await db.comments.where('paragraphId').equals(paragraphId).toArray()
    const seq = siblings.reduce((max, row) => Math.max(max, row.seq ?? 0), -1) + 1
    await db.comments.add(toRow(paragraphId, batchId, id, parent ? parent.id : '', comment, seq))
  })
  return id
}

export async function setCommentMark(
  commentId: string,
  mark: keyof CommentMarks,
  on: boolean,
): Promise<void> {
  await db.comments.update(commentId, { [mark]: on } as Partial<CommentRow>)
}

const TASTE_TTL_MS = 60_000
const tasteCache = new Map<string, { at: number; value: string }>()

export async function tasteExamplesFor(bookId: string): Promise<string> {
  const cached = tasteCache.get(bookId)
  if (cached && Date.now() - cached.at < TASTE_TTL_MS) return cached.value
  const ids = (await db.paragraphs.where('bookId').equals(bookId).primaryKeys()) as string[]
  if (ids.length === 0) return ''
  const marked = await db.paragraphs
    .where('bookId')
    .equals(bookId)
    .filter((paragraph) => paragraph.userMarked === 'interesting')
    .toArray()
  const comments = await db.comments
    .where('paragraphId')
    .anyOf(ids)
    .filter((comment) => comment.saved === true || comment.boring === true || comment.spoiler === true || comment.wrong === true)
    .toArray()
  const line = (comment: CommentRow, label: string) => `${label}：${comment.text.slice(0, 50)}`
  const value = [
    ...marked.slice(-3).map((paragraph) => `想再看到：${paragraph.text.slice(0, 50)}`),
    ...comments
      .filter((comment) => comment.saved)
      .slice(-3)
      .map((comment) => line(comment, '想再看到')),
    ...comments
      .filter((comment) => comment.boring || comment.spoiler || comment.wrong)
      .slice(-3)
      .map((comment) => line(comment, '不要这样')),
  ].join('\n')
  tasteCache.set(bookId, { at: Date.now(), value })
  return value
}

function rank(comment: Pick<CommentRow, 'authorType' | 'kind'>): number {
  if (comment.authorType === 'user') return 0
  if (comment.kind === 'deep') return 1
  if (comment.kind === 'background') return 2
  if (comment.authorType === 'resident') return 3
  return 4
}

function markKey(row: Pick<CommentRow, 'authorType' | 'displayName' | 'text'>): string {
  return `${row.authorType}|${row.displayName}|${row.text.trim()}`
}

/**
 * 写入（或重写）这一段当前显示的那一批 AI 评论。
 * 用户区不动；用户回过话的 AI 主楼整楼保留；内容相同的旧评论把标记带过来。
 */
export async function saveParagraphComments(
  paragraphId: string,
  comments: StoredComment[],
  score: number,
  genStatus: GenStatus,
): Promise<void> {
  await db.transaction('rw', [db.commentBatches, db.comments, db.paragraphs], async () => {
    const batches = await db.commentBatches.where('paragraphId').equals(paragraphId).toArray()
    let batch = latestBatch(batches)
    if (!batch && comments.length > 0) {
      batch = { id: createId(), paragraphId, batchNo: 1, createdAt: nowIso() }
      await db.commentBatches.add(batch)
    }
    if (batch) {
      const batchId = batch.id
      const existing = await db.comments.where('batchId').equals(batchId).toArray()
      const keepRoots = rootsWithUserReplies(existing)
      const kept = existing.filter((row) => keepRoots.has(row.id) || keepRoots.has(row.parentId))
      const removed = existing.filter((row) => !kept.includes(row))
      const marks = new Map(removed.map((row) => [markKey(row), marksOf(row)]))
      const withMarks = (row: CommentRow): CommentRow => {
        const found = marks.get(markKey(row))
        if (!found) return row
        return {
          ...row,
          ...(found.saved ? { saved: true } : {}),
          ...(found.boring ? { boring: true } : {}),
          ...(found.spoiler ? { spoiler: true } : {}),
          ...(found.wrong ? { wrong: true } : {}),
        }
      }
      const rows: CommentRow[] = []
      let seq = 0
      for (const comment of comments) {
        const id = createId()
        rows.push(withMarks(toRow(paragraphId, batchId, id, '', comment, seq)))
        seq += 1
        for (const reply of comment.replies ?? []) {
          rows.push(withMarks(toRow(paragraphId, batchId, createId(), id, reply, seq)))
          seq += 1
        }
      }
      if (removed.length > 0) await db.comments.bulkDelete(removed.map((row) => row.id))
      if (rows.length > 0) await db.comments.bulkAdd(rows)
    }
    await db.paragraphs.update(paragraphId, { score, genStatus })
  })
}

/** 新开一批。传进来的评论会换新 id；主楼不在这批里的回复丢掉。 */
export async function saveNextBatch(
  paragraphId: string,
  batchNo: number,
  comments: CommentRow[],
): Promise<void> {
  const batchId = createId()
  const idMap = new Map<string, string>()
  for (const comment of comments) idMap.set(comment.id, createId())
  const rows = comments
    .filter((comment) => !comment.parentId || idMap.has(comment.parentId))
    .map((comment) => ({
      ...comment,
      id: idMap.get(comment.id) ?? createId(),
      batchId,
      paragraphId,
      parentId: comment.parentId ? (idMap.get(comment.parentId) ?? '') : '',
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
    kind: comment.kind,
    title: comment.title,
    evidence: comment.evidence,
    background: comment.background,
    question: comment.question,
    replyType: comment.replyType,
    seq,
  }
}

export async function replacePinned(paragraphId: string, kind: CommentKind, comments: StoredComment[]): Promise<void> {
  await db.transaction('rw', [db.comments], async () => {
    const existing = await db.comments.where('paragraphId').equals(paragraphId).toArray()
    const pinned = existing.filter((row) => row.batchId === USER_ZONE && (row.kind === kind || existing.some((item) => item.id === row.parentId && item.kind === kind)))
    if (pinned.length > 0) await db.comments.bulkDelete(pinned.map((row) => row.id))
    const rows: CommentRow[] = []
    let seq = existing.reduce((max, row) => Math.max(max, row.seq ?? 0), -1) + 1
    for (const comment of comments) {
      const id = createId()
      rows.push(toRow(paragraphId, USER_ZONE, id, '', comment, seq))
      seq += 1
      for (const reply of comment.replies ?? []) {
        rows.push(toRow(paragraphId, USER_ZONE, createId(), id, reply, seq))
        seq += 1
      }
    }
    if (rows.length > 0) await db.comments.bulkAdd(rows)
  })
}

export async function listRecentCommentTexts(chapterIds: string[], limit = 100): Promise<string[]> {
  if (chapterIds.length === 0) return []
  const paragraphs = await db.paragraphs.where('chapterId').anyOf(chapterIds).toArray()
  const ids = paragraphs.map((row) => row.id)
  if (ids.length === 0) return []
  const comments = await db.comments.where('paragraphId').anyOf(ids).toArray()
  return comments
    .filter((comment) => comment.authorType !== 'user' && comment.text.trim())
    .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
    .slice(0, limit)
    .map((comment) => comment.text)
}

export async function replaceObservations(paragraphIds: string[], rows: ObservationRow[]): Promise<void> {
  await db.transaction('rw', [db.observations], async () => {
    if (paragraphIds.length > 0) await db.observations.where('paragraphId').anyOf(paragraphIds).delete()
    if (rows.length > 0) await db.observations.bulkAdd(rows)
  })
}

export async function listObservationsFor(paragraphId: string): Promise<ObservationRow[]> {
  return db.observations.where('paragraphId').equals(paragraphId).toArray()
}

export async function listRecentAngles(chapterIds: string[], limit = 20): Promise<string[]> {
  if (chapterIds.length === 0) return []
  const rows = await db.observations.where('chapterId').anyOf(chapterIds).toArray()
  return rows
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
    .map((row) => `${row.kind}：${row.point}`)
}

export async function listDeepSpots(chapterId: string): Promise<DeepSpotRow[]> {
  return db.deepSpots.where('chapterId').equals(chapterId).toArray()
}

export async function saveDeepSpots(rows: DeepSpotRow[]): Promise<void> {
  if (rows.length === 0) return
  await db.deepSpots.bulkPut(rows)
}

export async function updateDeepSpot(id: string, patch: Partial<DeepSpotRow>): Promise<void> {
  await db.deepSpots.update(id, patch)
}

export async function listCommentsForDiversity(bookId: string, limit = 200): Promise<string[]> {
  const paragraphs = await db.paragraphs.where('bookId').equals(bookId).primaryKeys()
  if (paragraphs.length === 0) return []
  const comments = await db.comments.where('paragraphId').anyOf(paragraphs as string[]).toArray()
  return comments
    .filter((comment) => comment.authorType !== 'user' && comment.text.trim())
    .slice(-limit)
    .map((comment) => comment.text)
}

export async function markParagraph(paragraphId: string, genStatus: GenStatus, score?: number | null): Promise<void> {
  await db.paragraphs.update(paragraphId, score === undefined ? { genStatus } : { genStatus, score })
}

export async function markUserInterest(paragraphId: string): Promise<void> {
  await db.paragraphs.update(paragraphId, { userMarked: 'interesting' })
}

function stateFrom(bookId: string, row: BookMemoryRow | undefined): MemoryState {
  if (!row) return { memory: emptyMemory(bookId), entities: [], synopsis: '', synopsisThrough: -1 }
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
    synopsis: row.synopsis ?? '',
    synopsisThrough: row.synopsisThrough ?? -1,
  }
}

function rowFrom(state: MemoryState): BookMemoryRow {
  const { memory } = state
  const row: BookMemoryRow = {
    bookId: memory.bookId,
    nicknames: memory.nicknames,
    predictions: memory.predictions,
    debates: memory.debates,
    scenes: memory.scenes,
    stances: memory.stances,
    userStance: memory.userStance,
    entities: state.entities,
    synopsis: state.synopsis,
    synopsisThrough: state.synopsisThrough,
    updatedAt: memory.updatedAt,
  }
  return JSON.parse(JSON.stringify(row)) as BookMemoryRow
}

export async function readMemory(bookId: string): Promise<MemoryState> {
  return stateFrom(bookId, await db.bookMemories.get(bookId))
}

/** 整体覆盖。只给用户在档案页手动编辑时用。 */
export async function writeMemory(memory: BookMemory, entities: string[]): Promise<void> {
  await db.transaction('rw', [db.bookMemories], async () => {
    const current = stateFrom(memory.bookId, await db.bookMemories.get(memory.bookId))
    await db.bookMemories.put(rowFrom({ ...current, memory, entities }))
  })
}

/**
 * 读最新一份、合并、写回，都在同一个事务里。
 * 生成任务并发跑，各自拿旧快照整行覆盖会互相吃掉更新。
 */
export async function updateMemory(bookId: string, fn: (state: MemoryState) => MemoryState): Promise<MemoryState> {
  return db.transaction('rw', [db.bookMemories], async () => {
    const next = fn(stateFrom(bookId, await db.bookMemories.get(bookId)))
    await db.bookMemories.put(rowFrom(next))
    return next
  })
}

export type { DroppedLog, ObservationRow, DeepSpotRow }

export async function writeGenerationLog(entry: Omit<GenerationLogRow, 'id' | 'createdAt'>): Promise<void> {
  await db.generationLogs.add({
    ...entry,
    id: createId(),
    createdAt: nowIso(),
  })
}
