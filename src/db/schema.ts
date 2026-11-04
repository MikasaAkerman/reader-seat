import Dexie, { type EntityTable } from 'dexie'
import type {
  AuthorType,
  DebateEntry,
  NicknameEntry,
  Prediction,
  SceneEntry,
  SpoilerLevel,
  StanceEntry,
  UnlockMode,
} from '@/core/types'

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
  /** 章末微评输入是否默认展开。缺省为展开。 */
  microReviewOpen?: boolean
  lineup: Record<string, boolean>
  createdAt: string
  updatedAt: string
  fileMissing?: boolean
}

export interface ChapterRow {
  id: string
  bookId: string
  order: number
  href: string
  title: string
  readStatus: ReadStatus
  summary?: string
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
  /** 0 到 3。还没生成时缺省。 */
  score?: number | null
  userMarked?: 'interesting'
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

export interface CommentBatchRow {
  id: string
  paragraphId: string
  batchNo: number
  createdAt: string
}

export interface CommentRow {
  id: string
  batchId: string
  paragraphId: string
  /** 主楼为空字符串，回复指向主楼 id */
  parentId: string
  authorType: AuthorType
  displayName: string
  role: string
  text: string
  /** 同一批里的写入顺序，用来稳定楼中楼的前两条 */
  seq?: number
  mismatched?: boolean
  saved?: boolean
  boring?: boolean
  spoiler?: boolean
  wrong?: boolean
}

export interface BookMemoryRow {
  bookId: string
  nicknames: NicknameEntry[]
  predictions: Prediction[]
  debates: DebateEntry[]
  scenes?: SceneEntry[]
  stances?: StanceEntry[]
  userStance?: string[]
  entities: string[]
  updatedAt: string
}

export interface GenerationLogRow {
  id: string
  bookId: string
  type: 'rough' | 'refine' | 'live' | 'chapterTalk' | 'spoilerCheck'
  createdAt: string
  ok: boolean
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  cost: number
  error?: string
  latencyMs?: number
}

export interface UserNoteRow {
  id: string
  bookId: string
  chapterId: string
  paragraphId: string
  type: '划线批注' | '本章微评'
  text: string
  quote?: string
  start?: number
  end?: number
  judgment?: string
  evidence?: string
  reservation?: string
  createdAt: string
}

export interface TalkLine {
  role: string
  text: string
}

export interface ChapterTalkRow {
  id: string
  bookId: string
  chapterId: string
  paragraphId: string
  hotParagraphIds: string[]
  residentLines: TalkLine[]
  debates: { topic: string; summary: string }[]
  predictionUpdates: { predictionId: string; status: string }[]
  replies: TalkLine[]
  createdAt: string
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
  bookMemories!: EntityTable<BookMemoryRow, 'bookId'>
  predictions!: EntityTable<ScopedRow, 'id'>
  commentBatches!: EntityTable<CommentBatchRow, 'id'>
  comments!: EntityTable<CommentRow, 'id'>
  userNotes!: EntityTable<UserNoteRow, 'id'>
  chapterTalks!: EntityTable<ChapterTalkRow, 'id'>
  readingStates!: EntityTable<ReadingStateRow, 'bookId'>
  generationLogs!: EntityTable<GenerationLogRow, 'id'>
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
