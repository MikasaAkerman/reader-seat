import { defineStore } from 'pinia'
import { ref } from 'vue'
import { latestBatch, localDay, rerollsOnDay } from '@/core/comments/batches'
import { commentsHidden, paragraphLocked } from '@/core/reading/unlock'
import type { UnlockMode } from '@/core/types'
import {
  bubbleFor,
  commentCounts,
  listBatches,
  listThreads,
  setCommentMark,
  type BubbleState,
  type CommentMarks,
  type ReaderThread,
} from '@/db/repos/comments'
import { listParagraphs } from '@/db/repos/library'
import { ownParagraphIds } from '@/db/repos/notes'

export const useCommentsStore = defineStore('comments', () => {
  const bubbles = ref<Record<string, BubbleState>>({})
  const threads = ref<ReaderThread[]>([])
  const activeId = ref('')
  const batchNo = ref(0)
  const batchCount = ref(0)
  const rerollsLeft = ref(3)
  const chapterLocked = ref(false)
  let chapter = ''
  let bookId = ''
  let unlockMode: UnlockMode = '关闭'
  let chapterDone = false
  let lastPending = new Set<string>()

  function setGate(input: { bookId: string; mode: UnlockMode; chapterDone: boolean }) {
    bookId = input.bookId
    unlockMode = input.mode
    chapterDone = input.chapterDone
  }

  async function loadChapter(chapterId: string, pending: ReadonlySet<string>) {
    chapter = chapterId
    lastPending = new Set(pending)
    const rows = await listParagraphs(chapterId)
    const ids = rows.map((row) => row.id)
    const own = bookId ? await ownParagraphIds(bookId, chapterId, ids) : new Set<string>()
    chapterLocked.value = commentsHidden(unlockMode, chapterDone, own.has(`micro:${chapterId}`))
    const counts = await commentCounts(ids)
    const next: Record<string, BubbleState> = {}
    if (!chapterLocked.value) {
      for (const row of rows) {
        const bubble = bubbleFor(row.genStatus, row.score, counts[row.id] ?? 0, pending.has(row.id))
        if (!bubble) continue
        const locked = paragraphLocked(unlockMode, own.has(row.id))
        next[row.id] = locked ? { ...bubble, locked: true } : bubble
      }
    }
    bubbles.value = next
    if (activeId.value) await open(activeId.value, batchNo.value || undefined)
  }

  async function open(paragraphId: string, requestedBatch?: number) {
    activeId.value = paragraphId
    const batches = await listBatches(paragraphId)
    const latest = latestBatch(batches)
    const chosen = requestedBatch && batches.some((batch) => batch.batchNo === requestedBatch) ? requestedBatch : latest?.batchNo
    batchNo.value = chosen ?? 0
    batchCount.value = batches.length
    rerollsLeft.value = Math.max(0, 3 - rerollsOnDay(batches, localDay(new Date())))
    threads.value = chosen ? await listThreads(paragraphId, chosen) : []
  }

  async function showBatch(offset: number) {
    if (!activeId.value) return
    const batches = await listBatches(activeId.value)
    const ordered = [...batches].sort((a, b) => a.batchNo - b.batchNo)
    const index = ordered.findIndex((batch) => batch.batchNo === batchNo.value)
    const next = ordered[index + offset]
    if (!next) return
    await open(activeId.value, next.batchNo)
  }

  function close() {
    activeId.value = ''
    threads.value = []
  }

  async function mark(id: string, kind: keyof CommentMarks, on: boolean) {
    await setCommentMark(id, kind, on)
    if (chapter) await loadChapter(chapter, lastPending)
  }

  return {
    bubbles,
    threads,
    activeId,
    batchNo,
    batchCount,
    rerollsLeft,
    chapterLocked,
    setGate,
    loadChapter,
    open,
    showBatch,
    close,
    mark,
  }
})
