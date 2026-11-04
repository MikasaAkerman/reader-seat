import { parseEpub, relinkComments, type ParsedBook } from '@/core/epub'
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
}

export interface BookCard {
  id: string
  title: string
  author: string
  progress: string
}

export type ImportOutcome =
  | { status: 'existing'; bookId: string }
  | { status: 'created'; bookId: string }
  | { status: 'updated'; bookId: string }

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

async function replaceEdition(book: BookRow, parsed: ParsedBook, bytes: Uint8Array) {
  const oldChapters = await db.chapters.where('bookId').equals(book.id).toArray()
  const oldParagraphs = await db.paragraphs.where('bookId').equals(book.id).toArray()
  const { chapters, paragraphs } = rowsFromParsed(book.id, parsed)
  const oldIds = oldParagraphs.map((paragraph) => paragraph.id)
  const comments = oldIds.length
    ? await db.comments.where('paragraphId').anyOf(oldIds).toArray()
    : []
  const relinked = relinkComments(oldParagraphs, paragraphs, comments)
  const state = await db.readingStates.get(book.id)
  const nextState = retargetState(state, oldChapters, oldParagraphs, chapters, paragraphs)

  await db.transaction(
    'rw',
    [db.books, db.chapters, db.paragraphs, db.comments, db.readingStates],
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
      await db.books.update(book.id, {
        author: parsed.author,
        translator: parsed.translator,
        fingerprint: parsed.fingerprint,
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
): ReadingStateRow | null {
  if (!state) return null
  const oldChapter = oldChapters.find((chapter) => chapter.id === state.chapterId)
  const oldParagraph = oldParagraphs.find(
    (paragraph) => paragraph.chapterId === state.chapterId && paragraph.order === state.paragraphIndex,
  )
  const nextParagraph = oldParagraph
    ? paragraphs.find((paragraph) => paragraph.anchor === oldParagraph.anchor)
    : undefined
  const nextChapter =
    chapters.find((chapter) => chapter.id === nextParagraph?.chapterId) ??
    chapters.find((chapter) => chapter.href === oldChapter?.href)
  if (!nextChapter) return null
  const readUpTo: Record<string, number> = {}
  for (const [oldId, order] of Object.entries(state.readUpTo)) {
    const href = oldChapters.find((chapter) => chapter.id === oldId)?.href
    const target = chapters.find((chapter) => chapter.href === href)
    const oldAnchor = oldParagraphs.find(
      (paragraph) => paragraph.chapterId === oldId && paragraph.order === order,
    )?.anchor
    const matched = paragraphs.find((paragraph) => paragraph.anchor === oldAnchor)
    if (target && matched && matched.chapterId === target.id) readUpTo[target.id] = matched.order
  }
  return {
    bookId: state.bookId,
    chapterId: nextParagraph?.chapterId ?? nextChapter.id,
    paragraphIndex: nextParagraph?.order ?? 1,
    offsetRatio: nextParagraph ? state.offsetRatio : 0,
    readUpTo,
    updatedAt: nowIso(),
  }
}

export async function importBookBytes(bytes: Uint8Array, fileName: string): Promise<ImportOutcome> {
  const parsed = await parseEpubSafe(bytes, fileName)
  const existing = await db.books.where('fingerprint').equals(parsed.fingerprint).first()
  if (existing) return { status: 'existing', bookId: existing.id }
  const sameTitle = await db.books.where('title').equals(parsed.title).first()
  if (sameTitle) {
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
      progress: progressLabel(chapters, state),
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
  const done = input.chapterLength > 0 && input.readUpTo >= input.chapterLength
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
