import { defineStore } from 'pinia'
import { ref } from 'vue'
import { bubbleFor, commentCounts, listThreads, type BubbleState, type ReaderThread } from '@/db/repos/comments'
import { listParagraphs } from '@/db/repos/library'

export const useCommentsStore = defineStore('comments', () => {
  const bubbles = ref<Record<string, BubbleState>>({})
  const threads = ref<ReaderThread[]>([])
  const activeId = ref('')

  async function loadChapter(chapterId: string, pending: ReadonlySet<string>) {
    const rows = await listParagraphs(chapterId)
    const counts = await commentCounts(rows.map((row) => row.id))
    const next: Record<string, BubbleState> = {}
    for (const row of rows) {
      const bubble = bubbleFor(row.genStatus, row.score, counts[row.id] ?? 0, pending.has(row.id))
      if (bubble) next[row.id] = bubble
    }
    bubbles.value = next
    if (activeId.value) threads.value = await listThreads(activeId.value)
  }

  async function open(paragraphId: string) {
    activeId.value = paragraphId
    threads.value = await listThreads(paragraphId)
  }

  function close() {
    activeId.value = ''
    threads.value = []
  }

  return { bubbles, threads, activeId, loadChapter, open, close }
})
