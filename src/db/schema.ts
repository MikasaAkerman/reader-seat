import Dexie, { type EntityTable } from 'dexie'
import type { SpoilerLevel, UnlockMode } from '@/core/types'

export type ReadStatus = 'unread' | 'reading' | 'done'
export type GenStatus = 'none' | 'rough' | 'refining' | 'refined' | 'failed'
export type ParagraphKind = 'heading' | 'body'

export interface SettingsRow {
  key: string
  value: unknown
}

export interface BookRow {
  id: string
  title: string
  author: string
  translator: string
  fingerprint: string
  station: number | null
  spoilerLevel: SpoilerLevel
  unlockMode: UnlockMode
  lineup: Record<string, boolean>
  createdAt: string
  updatedAt: string
}

export interface ChapterRow {
  id: string
  bookId: string
  order: number
  href: string
  title: string
  readStatus: ReadStatus
}

export interface ParagraphRow {
  id: string
  bookId: string
  chapterId: string
  order: number
  anchor: string
  text: string
  html: string
  textHash: string
  kind: ParagraphKind
  genStatus: GenStatus
}

export interface ReadingStateRow {
  bookId: string
  chapterId: string
  paragraphIndex: number
  offsetRatio: number
  /** 每章已读到的最大段落序号 */
  readUpTo: Record<string, number>
  updatedAt: string
}

export interface BookFileRow {
  bookId: string
  bytes: Uint8Array
}

export interface CommentRow {
  id: string
  batchId: string
  paragraphId: string
  parentId: string
  authorType: string
  mismatched?: boolean
}

/** 只为按已有索引删除关联行，字段在后续里程碑补全。 */
interface ScopedRow {
  id: string
  bookId: string
  chapterId: string
  paragraphId: string
}

export class ReaderSeatDB extends Dexie {
  books!: EntityTable<BookRow, 'id'>
  chapters!: EntityTable<ChapterRow, 'id'>
  paragraphs!: EntityTable<ParagraphRow, 'id'>
  residentReaders!: EntityTable<ScopedRow, 'id'>
  bookMemories!: EntityTable<{ bookId: string }, 'bookId'>
  predictions!: EntityTable<ScopedRow, 'id'>
  commentBatches!: EntityTable<ScopedRow, 'id'>
  comments!: EntityTable<CommentRow, 'id'>
  userNotes!: EntityTable<ScopedRow, 'id'>
  chapterTalks!: EntityTable<ScopedRow, 'id'>
  readingStates!: EntityTable<ReadingStateRow, 'bookId'>
  generationLogs!: EntityTable<ScopedRow, 'id'>
  settings!: EntityTable<SettingsRow, 'key'>
  bookFiles!: EntityTable<BookFileRow, 'bookId'>

  constructor() {
    super('reader-seat')
    this.version(1).stores({
      books: 'id, fingerprint, title, updatedAt',
      chapters: 'id, bookId, [bookId+order]',
      paragraphs: 'id, bookId, chapterId, [chapterId+order], genStatus',
      residentReaders: 'id, bookId',
      bookMemories: 'bookId',
      predictions: 'id, bookId, status',
      commentBatches: 'id, paragraphId, [paragraphId+batchNo]',
      comments: 'id, batchId, paragraphId, parentId, authorType',
      userNotes: 'id, bookId, paragraphId, type',
      chapterTalks: 'id, chapterId',
      readingStates: 'bookId',
      generationLogs: 'id, bookId, type, createdAt',
      settings: 'key',
      bookFiles: 'bookId',
    })
  }
}

export const db = new ReaderSeatDB()
