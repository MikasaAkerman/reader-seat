import Dexie, { type EntityTable } from 'dexie'

/** M0：表键与技术方案 §4.8 对齐；字段在后续里程碑按需细化。 */
export interface SettingsRow {
  key: string
  value: unknown
}

export class ReaderSeatDB extends Dexie {
  books!: EntityTable<Record<string, unknown>, 'id'>
  chapters!: EntityTable<Record<string, unknown>, 'id'>
  paragraphs!: EntityTable<Record<string, unknown>, 'id'>
  residentReaders!: EntityTable<Record<string, unknown>, 'id'>
  bookMemories!: EntityTable<Record<string, unknown>, 'bookId'>
  predictions!: EntityTable<Record<string, unknown>, 'id'>
  commentBatches!: EntityTable<Record<string, unknown>, 'id'>
  comments!: EntityTable<Record<string, unknown>, 'id'>
  userNotes!: EntityTable<Record<string, unknown>, 'id'>
  chapterTalks!: EntityTable<Record<string, unknown>, 'id'>
  readingStates!: EntityTable<Record<string, unknown>, 'bookId'>
  generationLogs!: EntityTable<Record<string, unknown>, 'id'>
  settings!: EntityTable<SettingsRow, 'key'>
  bookFiles!: EntityTable<Record<string, unknown>, 'bookId'>

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
