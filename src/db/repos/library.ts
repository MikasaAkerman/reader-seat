import { matchParagraphs, parseEpub, relinkComments, type ParagraphRef, type ParsedBook } from '@/core/epub'
import { DEFAULT_LINEUP } from '@/core/personas'
import type { SpoilerLevel, UnlockMode } from '@/core/types'
import { platform } from '@/platform'
import { createId } from '../id'
import {
  db,
  type BookRow,
  type ChapterRow,
  type ParagraphRow,
  type ReadingStateRow,
} from '../schema'

export interface BookSettings {
  spoilerLevel: SpoilerLevel
  unlockMode: UnlockMode
  lineup: Record<string, boolean>
  station: number | null
  microReviewOpen?: boolean
}

export interface BookCard {
  id: string
  title: string
  author: string
  progress: string
  fileMissing: boolean
}

export type ImportOutcome =
  | { status: 'existing'; bookId: string }
  | { status: 'created'; bookId: string }
  | { status: 'updated'; bookId: string }
  | { status: 'conflict'; bookId: string; title: string }

export interface ProgressInput {
  chapterId: string
  paragraphIndex: number
  offsetRatio: number
  readUpTo: number
  chapterLength: number
}

function nowIso(): string {
  return new Date().toISOString()
}

export function defaultLineup(): Record<string, boolean> {
  return Object.fromEntries(DEFAULT_LINEUP.map((persona) => [persona.role, true]))
}

function rowsFromParsed(bookId: string, parsed: ParsedBook): {
  chapters: ChapterRow[]
  paragraphs: ParagraphRow[]
} {
  const chapters: ChapterRow[] = []
  const paragraphs: ParagraphRow[] = []
  for (const chapter of parsed.chapters) {
    const chapterId = createId()
    chapters.push({
      id: chapterId,
      bookId,
      order: chapter.order,
      href: chapter.href,
      title: chapter.title,
      readStatus: 'unread',
    })
    for (const paragraph of chapter.paragraphs) {
      paragraphs.push({
        id: createId(),
        bookId,
        chapterId,
        order: paragraph.order,
        anchor: paragraph.anchor,
        text: paragraph.text,
        html: paragraph.html,
        textHash: paragraph.textHash,
        kind: paragraph.kind,
        genStatus: 'none',
      })
    }
  }
  return { chapters, paragraphs }
}

async function writeRows(bookId: string, parsed: ParsedBook, bytes: Uint8Array, settings: BookSettings, createdAt: string) {
  const { chapters, paragraphs } = rowsFromParsed(bookId, parsed)
  const book: BookRow = {
    id: bookId,
    title: parsed.title,
    author: parsed.author,
    translator: parsed.translator,
    fingerprint: parsed.fingerprint,
    station: settings.station,
    spoilerLevel: settings.spoilerLevel,
    unlockMode: settings.unlockMode,
    microReviewOpen: settings.microReviewOpen !== false,
    lineup: settings.lineup,
    createdAt,
    updatedAt: nowIso(),
  }
  await db.transaction('rw', [db.books, db.chapters, db.paragraphs], async () => {
    await db.books.put(book)
    await db.chapters.bulkAdd(chapters)
    await db.paragraphs.bulkAdd(paragraphs)
  })
  try {
    await platform.saveBookFile(bookId, bytes)
  } catch (err) {
    await db.transaction('rw', [db.books, db.chapters, db.paragraphs], async () => {
      await db.paragraphs.where('bookId').equals(bookId).delete()
      await db.chapters.where('bookId').equals(bookId).delete()
      await db.books.delete(bookId)
    })
    throw err
  }
}

function paragraphRefs(chapters: ChapterRow[], paragraphs: ParagraphRow[]): ParagraphRef[] {
  const href = new Map(chapters.map((chapter) => [chapter.id, chapter.href]))
  return paragraphs.map((paragraph) => ({
    id: paragraph.id,
    chapterHref: href.get(paragraph.chapterId) ?? '',
    order: paragraph.order,
    textHash: paragraph.textHash,
    text: paragraph.text,
  }))
}

/** 新版本替换旧版本：段落按文本对应，评论、批、批注、本章说、章节摘要和阅读进度都跟过去。 */
async function replaceEdition(book: BookRow, parsed: ParsedBook, bytes: Uint8Array) {
  const oldChapters = await db.chapters.where('bookId').equals(book.id).toArray()
  const oldParagraphs = await db.paragraphs.where('bookId').equals(book.id).toArray()
  const { chapters, paragraphs } = rowsFromParsed(book.id, parsed)
  const matched = matchParagraphs(paragraphRefs(oldChapters, oldParagraphs), paragraphRefs(chapters, paragraphs))

  const chapterMap = new Map<string, string>()
  for (const old of oldChapters) {
    const next = chapters.find((chapter) => chapter.href === old.href)
    if (!next) continue
    chapterMap.set(old.id, next.id)
    if (old.summary) next.summary = old.summary
    next.readStatus = old.readStatus
  }
  const newById = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]))
  for (const old of oldParagraphs) {
    const next = newById.get(matched.get(old.id) ?? '')
    if (!next) continue
    next.genStatus = old.genStatus
    if (old.score !== undefined) next.score = old.score
    if (old.userMarked) next.userMarked = old.userMarked
  }

  const oldIds = oldParagraphs.map((paragraph) => paragraph.id)
  const comments = oldIds.length ? await db.comments.where('paragraphId').anyOf(oldIds).toArray() : []
  const batches = oldIds.length ? await db.commentBatches.where('paragraphId').anyOf(oldIds).toArray() : []
  const notes = await db.userNotes.where('bookId').equals(book.id).toArray()
  const oldChapterIds = oldChapters.map((chapter) => chapter.id)
  const talks = oldChapterIds.length ? await db.chapterTalks.where('chapterId').anyOf(oldChapterIds).toArray() : []
  const relinked = relinkComments(matched, comments)
  const state = await db.readingStates.get(book.id)
  const nextState = retargetState(state, oldChapters, oldParagraphs, chapters, paragraphs, matched)

  await db.transaction(
    'rw',
    [db.books, db.chapters, db.paragraphs, db.comments, db.commentBatches, db.userNotes, db.chapterTalks, db.readingStates],
    async () => {
      await db.paragraphs.where('bookId').equals(book.id).delete()
      await db.chapters.where('bookId').equals(book.id).delete()
      await db.chapters.bulkAdd(chapters)
      await db.paragraphs.bulkAdd(paragraphs)
      for (const comment of relinked) {
        await db.comments.update(comment.id, {
          paragraphId: comment.paragraphId,
          mismatched: comment.mismatched,
        })
      }
      for (const batch of batches) {
        const paragraphId = matched.get(batch.paragraphId)
        if (paragraphId) await db.commentBatches.update(batch.id, { paragraphId })
      }
      for (const note of notes) {
        const paragraph = newById.get(matched.get(note.paragraphId) ?? '')
        const chapterId = paragraph?.chapterId ?? chapterMap.get(note.chapterId)
        if (!chapterId) continue
        await db.userNotes.update(note.id, { chapterId, ...(paragraph ? { paragraphId: paragraph.id } : {}) })
      }
      for (const talk of talks) {
        const chapterId = chapterMap.get(talk.chapterId)
        if (!chapterId) continue
        await db.chapterTalks.update(talk.id, {
          chapterId,
          paragraphId: matched.get(talk.paragraphId) ?? '',
          hotParagraphIds: talk.hotParagraphIds.flatMap((id) => {
            const next = matched.get(id)
            return next ? [next] : []
          }),
        })
      }
      await db.books.update(book.id, {
        author: parsed.author,
        translator: parsed.translator,
        fingerprint: parsed.fingerprint,
        fileMissing: false,
        updatedAt: nowIso(),
      })
      if (nextState) await db.readingStates.put(nextState)
      else if (state) await db.readingStates.delete(book.id)
    },
  )
  await platform.saveBookFile(book.id, bytes)
}

function retargetState(
  state: ReadingStateRow | undefined,
  oldChapters: ChapterRow[],
  oldParagraphs: ParagraphRow[],
  chapters: ChapterRow[],
  paragraphs: ParagraphRow[],
  matched: ReadonlyMap<string, string>,
): ReadingStateRow | null {
  if (!state) return null
  const newById = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]))
  /** 这一段对不上时往前找最近一段对得上的。 */
  const landing = (chapterId: string, order: number) => {
    const candidates = oldParagraphs
      .filter((paragraph) => paragraph.chapterId === chapterId && paragraph.order <= order)
      .sort((a, b) => b.order - a.order)
    for (const old of candidates) {
      const next = newById.get(matched.get(old.id) ?? '')
      if (next) return next
    }
    return undefined
  }
  const oldChapter = oldChapters.find((chapter) => chapter.id === state.chapterId)
  const exact = oldParagraphs.find(
    (paragraph) => paragraph.chapterId === state.chapterId && paragraph.order === state.paragraphIndex,
  )
  const nextParagraph = landing(state.chapterId, state.paragraphIndex)
  const nextChapter =
    chapters.find((chapter) => chapter.id === nextParagraph?.chapterId) ??
    chapters.find((chapter) => chapter.href === oldChapter?.href)
  if (!nextChapter) return null
  const readUpTo: Record<string, number> = {}
  for (const [oldId, order] of Object.entries(state.readUpTo)) {
    const href = oldChapters.find((chapter) => chapter.id === oldId)?.href
    const target = chapters.find((chapter) => chapter.href === href)
    const hit = landing(oldId, order)
    if (target && hit && hit.chapterId === target.id) readUpTo[target.id] = hit.order
  }
  const sameSpot = exact && nextParagraph && matched.get(exact.id) === nextParagraph.id
  return {
    bookId: state.bookId,
    chapterId: nextParagraph?.chapterId ?? nextChapter.id,
    paragraphIndex: nextParagraph?.order ?? 1,
    offsetRatio: sameSpot ? state.offsetRatio : 0,
    readUpTo,
    updatedAt: nowIso(),
  }
}

export interface ImportOptions {
  /** 同书名同译者时怎么办。不给就返回 conflict 让用户选。 */
  onConflict?: 'replace' | 'separate'
}

function sameTranslator(a: string, b: string): boolean {
  return a.replace(/\s+/g, '') === b.replace(/\s+/g, '')
}

export async function importBookBytes(
  bytes: Uint8Array,
  fileName: string,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const parsed = await parseEpubSafe(bytes, fileName)
  const existing = await db.books.where('fingerprint').equals(parsed.fingerprint).first()
  if (existing) {
    await platform.saveBookFile(existing.id, bytes)
    if (existing.fileMissing) await db.books.update(existing.id, { fileMissing: false, updatedAt: nowIso() })
    return { status: 'existing', bookId: existing.id }
  }
  const sameTitle = (await db.books.where('title').equals(parsed.title).toArray()).find((book) =>
    sameTranslator(book.translator, parsed.translator),
  )
  if (sameTitle && options.onConflict !== 'separate') {
    if (options.onConflict !== 'replace') return { status: 'conflict', bookId: sameTitle.id, title: sameTitle.title }
    await replaceEdition(sameTitle, parsed, bytes)
    return { status: 'updated', bookId: sameTitle.id }
  }
  const bookId = createId()
  await writeRows(
    bookId,
    parsed,
    bytes,
    { spoilerLevel: '严格', unlockMode: '关闭', lineup: defaultLineup(), station: null },
    nowIso(),
  )
  return { status: 'created', bookId }
}

async function parseEpubSafe(bytes: Uint8Array, fileName: string): Promise<ParsedBook> {
  const parsed = await parseEpub(bytes)
  if (!parsed.title) parsed.title = fileName.replace(/\.epub$/i, '') || '未命名'
  return parsed
}

export async function listBookCards(): Promise<BookCard[]> {
  const books = await db.books.orderBy('updatedAt').reverse().toArray()
  const cards: BookCard[] = []
  for (const book of books) {
    const chapters = await db.chapters.where('bookId').equals(book.id).sortBy('order')
    const state = await db.readingStates.get(book.id)
    cards.push({
      id: book.id,
      title: book.title,
      author: book.author,
      progress: book.fileMissing ? '需要重新导入文件' : progressLabel(chapters, state),
      fileMissing: book.fileMissing === true,
    })
  }
  return cards
}

function progressLabel(chapters: ChapterRow[], state: ReadingStateRow | undefined): string {
  if (!state) return '未读'
  if (chapters.length > 0 && chapters.every((chapter) => chapter.readStatus === 'done')) return '已读完'
  const chapter = chapters.find((item) => item.id === state.chapterId)
  return chapter ? `读到${chapter.title}` : '未读'
}

export async function getBook(bookId: string): Promise<BookRow | undefined> {
  return db.books.get(bookId)
}

export async function updateBookSettings(bookId: string, settings: BookSettings): Promise<void> {
  const updated = await db.books.update(bookId, { ...settings, updatedAt: nowIso() })
  if (updated === 0) throw new Error('找不到这本书')
}

export async function saveChapterSummary(chapterId: string, summary: string): Promise<void> {
  await db.chapters.update(chapterId, { summary })
}

export async function listChapters(bookId: string): Promise<ChapterRow[]> {
  return db.chapters.where('bookId').equals(bookId).sortBy('order')
}

export async function listParagraphs(chapterId: string): Promise<ParagraphRow[]> {
  return db.paragraphs.where('chapterId').equals(chapterId).sortBy('order')
}

export async function getReadingState(bookId: string): Promise<ReadingStateRow | undefined> {
  return db.readingStates.get(bookId)
}

export async function recordProgress(bookId: string, input: ProgressInput): Promise<void> {
  const current = await db.readingStates.get(bookId)
  const readUpTo = { ...(current?.readUpTo ?? {}) }
  readUpTo[input.chapterId] = Math.max(readUpTo[input.chapterId] ?? 0, input.readUpTo)
  await db.readingStates.put({
    bookId,
    chapterId: input.chapterId,
    paragraphIndex: input.paragraphIndex,
    offsetRatio: input.offsetRatio,
    readUpTo,
    updatedAt: nowIso(),
  })
  const chapter = await db.chapters.get(input.chapterId)
  // 读完过的章回头翻看不降级。
  const done =
    chapter?.readStatus === 'done' ||
    (input.chapterLength > 0 && (readUpTo[input.chapterId] ?? 0) >= input.chapterLength)
  await db.chapters.update(input.chapterId, { readStatus: done ? 'done' : 'reading' })
}

export async function deleteBook(bookId: string): Promise<void> {
  const paragraphs = await db.paragraphs.where('bookId').equals(bookId).toArray()
  const chapters = await db.chapters.where('bookId').equals(bookId).toArray()
  const paragraphIds = paragraphs.map((paragraph) => paragraph.id)
  const chapterIds = chapters.map((chapter) => chapter.id)
  await db.transaction(
    'rw',
    [
      db.books,
      db.chapters,
      db.paragraphs,
      db.residentReaders,
      db.bookMemories,
      db.predictions,
      db.commentBatches,
      db.comments,
      db.userNotes,
      db.chapterTalks,
      db.readingStates,
      db.generationLogs,
      db.bookFiles,
    ],
    async () => {
      if (paragraphIds.length > 0) {
        await db.comments.where('paragraphId').anyOf(paragraphIds).delete()
        await db.commentBatches.where('paragraphId').anyOf(paragraphIds).delete()
      }
      if (chapterIds.length > 0) {
        await db.chapterTalks.where('chapterId').anyOf(chapterIds).delete()
      }
      await db.paragraphs.where('bookId').equals(bookId).delete()
      const liveParagraphs = new Set((await db.paragraphs.toArray()).map((row) => row.id))
      await db.comments.filter((row) => !liveParagraphs.has(row.paragraphId)).delete()
      await db.commentBatches.filter((row) => !liveParagraphs.has(row.paragraphId)).delete()
      await db.chapters.where('bookId').equals(bookId).delete()
      await db.residentReaders.where('bookId').equals(bookId).delete()
      await db.bookMemories.delete(bookId)
      await db.predictions.where('bookId').equals(bookId).delete()
      await db.userNotes.where('bookId').equals(bookId).delete()
      await db.readingStates.delete(bookId)
      await db.generationLogs.where('bookId').equals(bookId).delete()
      await db.bookFiles.delete(bookId)
      await db.books.delete(bookId)
    },
  )
  try {
    await platform.deleteBookFile(bookId)
  } catch {
    // 浏览器里原文件就在 bookFiles，上面已经删掉。
  }
}

export async function listGenerationLogs() {
  return db.generationLogs.toArray()
}
