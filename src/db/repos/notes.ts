import { createId } from '../id'
import { db, type ChapterTalkRow, type UserNoteRow } from '../schema'

function nowIso(): string {
  return new Date().toISOString()
}

export async function listNotes(bookId: string): Promise<UserNoteRow[]> {
  return db.userNotes.where('bookId').equals(bookId).toArray()
}

export async function ownParagraphIds(bookId: string, chapterId: string, paragraphIds: string[]): Promise<Set<string>> {
  const own = new Set<string>()
  const notes = await listNotes(bookId)
  for (const note of notes) {
    if (note.chapterId === chapterId && note.type === '本章微评') own.add(`micro:${chapterId}`)
    if (note.type === '划线批注' && paragraphIds.includes(note.paragraphId)) own.add(note.paragraphId)
  }
  if (paragraphIds.length === 0) return own
  const comments = await db.comments.where('paragraphId').anyOf(paragraphIds).toArray()
  for (const comment of comments) {
    if (comment.authorType === 'user') own.add(comment.paragraphId)
  }
  return own
}

export async function saveHighlight(input: {
  bookId: string
  chapterId: string
  paragraphId: string
  quote: string
  text: string
  start: number
  end: number
}): Promise<void> {
  await db.userNotes.add({
    id: createId(),
    bookId: input.bookId,
    chapterId: input.chapterId,
    paragraphId: input.paragraphId,
    type: '划线批注',
    quote: input.quote,
    text: input.text,
    start: input.start,
    end: input.end,
    createdAt: nowIso(),
  })
}

export async function saveMicroReview(input: {
  bookId: string
  chapterId: string
  judgment: string
  evidence: string
  reservation: string
}): Promise<UserNoteRow> {
  const existing = (await db.userNotes.where('bookId').equals(input.bookId).toArray()).find(
    (note) => note.chapterId === input.chapterId && note.type === '本章微评',
  )
  const row: UserNoteRow = {
    id: existing?.id ?? createId(),
    bookId: input.bookId,
    chapterId: input.chapterId,
    paragraphId: '',
    type: '本章微评',
    text: `判断：${input.judgment}\n证据：${input.evidence}\n保留：${input.reservation}`,
    judgment: input.judgment,
    evidence: input.evidence,
    reservation: input.reservation,
    createdAt: existing?.createdAt ?? nowIso(),
  }
  await db.userNotes.put(row)
  return row
}

export async function deleteNote(id: string): Promise<void> {
  await db.userNotes.delete(id)
}

export async function readChapterTalk(chapterId: string): Promise<ChapterTalkRow | undefined> {
  return db.chapterTalks.where('chapterId').equals(chapterId).first()
}

export async function saveChapterTalk(row: ChapterTalkRow): Promise<void> {
  const existing = await readChapterTalk(row.chapterId)
  await db.chapterTalks.put({ ...row, id: existing?.id ?? row.id })
}

export async function addTalkReplies(chapterId: string, replies: ChapterTalkRow['replies']): Promise<void> {
  const existing = await readChapterTalk(chapterId)
  if (!existing) return
  await db.chapterTalks.put({ ...existing, replies })
}
