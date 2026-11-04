import { defineStore } from 'pinia'
import { ref } from 'vue'
import { estimateCost, type LlmUsage } from '@/core/llm'
import { EMPTY_USAGE } from '@/core/llm/types'
import { applyMemoryUpdates, formatMemoryForPrompt } from '@/core/memory'
import { briefLineup, fullLineup } from '@/core/personas'
import { formatBlock, runRefine, runRough } from '@/core/generation'
import {
  assignGeneration,
  blockIndex,
  BUFFER_LOW,
  BUFFER_TARGET,
  lineupFor,
  planNextBlock,
  readyAhead,
  toTextBlock,
} from '@/core/generation/pipeline'
import type { RefineComment } from '@/core/generation/schema'
import { Scheduler } from '@/core/scheduler'
import type { StoredComment } from '@/db/repos/comments'
import {
  markParagraph,
  readMemory,
  saveParagraphComments,
  writeGenerationLog,
  writeMemory,
} from '@/db/repos/comments'
import { getBook, listParagraphs } from '@/db/repos/library'
import type { ParagraphRow } from '@/db/schema'
import { useSettingsStore } from '@/stores/settings'
import { useCommentsStore } from '@/stores/comments'

const PRICING = {
  inputHitPerMTok: 0.1,
  inputMissPerMTok: 1,
  outputPerMTok: 2,
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function commentFrom(comment: RefineComment): StoredComment {
  const resident = comment.author_type === 'resident'
  return {
    authorType: comment.author_type,
    displayName: resident ? comment.reader_role || comment.display_name || '书友' : comment.display_name || '路人',
    role: comment.reader_role || '',
    text: comment.text,
  }
}

export const useGenerationStore = defineStore('generation', () => {
  const needsKey = ref(false)
  const pendingIds = ref<string[]>([])
  const scheduler = new Scheduler()
  const inflight = new Set<string>()
  let listening = false
  let currentBookId = ''
  let currentChapterId = ''
  let lastOrder = 0
  let hasPlace = false

  function touchPending() {
    pendingIds.value = [...inflight]
  }

  function forgetQueued() {
    for (const id of scheduler.dropPending()) inflight.delete(id)
  }

  function bind() {
    if (listening || typeof document === 'undefined') return
    listening = true
    const apply = () => {
      const paused = document.visibilityState === 'hidden' || navigator.onLine === false
      if (paused) scheduler.pause()
      else scheduler.resume()
    }
    document.addEventListener('visibilitychange', apply)
    window.addEventListener('online', apply)
    window.addEventListener('offline', apply)
    apply()
  }

  function stop() {
    scheduler.stop()
    inflight.clear()
    touchPending()
    hasPlace = false
  }

  async function refresh(chapterId: string) {
    await useCommentsStore().loadChapter(chapterId, inflight)
  }

  async function sync(input: { bookId: string; chapterId: string; order: number }) {
    bind()
    const settings = useSettingsStore()
    if (!settings.loaded) await settings.load()
    needsKey.value = !settings.apiKey
    currentBookId = input.bookId
    const paragraphs = await listParagraphs(input.chapterId)
    if (input.chapterId !== currentChapterId) {
      currentChapterId = input.chapterId
      lastOrder = input.order
      hasPlace = true
      forgetQueued()
    } else if (hasPlace) {
      const jump = blockIndex(paragraphs, input.order) - blockIndex(paragraphs, lastOrder)
      const previous = lastOrder
      lastOrder = input.order
      if (jump > 2 && input.order !== previous) {
        forgetQueued()
        enqueueLive(paragraphs, input.order)
      }
    } else {
      lastOrder = input.order
      hasPlace = true
    }
    await refresh(input.chapterId)
    if (needsKey.value) return
    ensure(paragraphs, input.order)
  }

  function ensure(rows: ParagraphRow[], order: number) {
    if (needsKey.value) return
    let covered = readyAhead(rows, order, inflight)
    if (covered >= BUFFER_LOW) return
    let cursor = order
    for (let guard = 0; covered < BUFFER_TARGET && guard < 8; guard++) {
      const block = planNextBlock(rows, cursor, inflight)
      if (!block || block.length === 0) break
      const last = block[block.length - 1]
      if (!last) break
      for (const row of block) inflight.add(row.id)
      scheduler.enqueue({
        kind: 'rough',
        key: block.map((row) => row.id).join(','),
        distance: Math.max(0, block[0]!.order - order),
        run: (signal) => runBlock(block, 'rough', signal),
      })
      covered += block.length
      cursor = last.order + 1
    }
    touchPending()
  }

  function enqueueLive(rows: ParagraphRow[], order: number) {
    const row = rows.find((item) => item.order === order)
    if (!row || row.genStatus !== 'none' || inflight.has(row.id)) return
    inflight.add(row.id)
    scheduler.enqueue({
      kind: 'live',
      key: row.id,
      distance: 0,
      run: (signal) => runBlock([row], 'live', signal),
    })
    touchPending()
  }

  async function retry(paragraphId: string) {
    const rows = await listParagraphs(currentChapterId)
    const row = rows.find((item) => item.id === paragraphId)
    if (!row) return
    await markParagraph(paragraphId, 'none', null)
    row.genStatus = 'none'
    inflight.delete(paragraphId)
    enqueueLive(rows, row.order)
    ensure(rows, lastOrder || row.order)
    await refresh(currentChapterId)
  }

  async function runBlock(rows: ParagraphRow[], kind: 'rough' | 'live', signal: AbortSignal) {
    const chapter = currentChapterId
    const bookId = currentBookId
    try {
      if (rows.every((row) => row.kind === 'heading')) {
        for (const row of rows) await saveParagraphComments(row.id, [], 0, 'rough')
        return
      }
      const book = await getBook(bookId)
      if (!book || signal.aborted) return
      const { memory, entities } = await readMemory(book.id)
      const lineup = lineupFor(book.spoilerLevel, book.lineup)
      const block = toTextBlock(rows)
      const client = useSettingsStore().createClient()
      const result = await runRough(
        {
          title: book.title,
          author: book.author,
          translator: book.translator,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: formatMemoryForPrompt(memory),
          priorSummary: '',
          blockText: formatBlock(block),
          knownEntities: entities,
          lineupText: briefLineup(lineup),
        },
        block,
        client,
        new Set(entities),
        signal,
      )
      if (signal.aborted) return
      const assigned = assignGeneration(rows, result.paragraphs)
      for (const item of assigned) {
        await saveParagraphComments(item.row.id, item.comments, item.score, item.genStatus)
        if (item.hot) {
          enqueueRefine(item.row, rows, result.new_entities, entities, memory.bookId)
        }
      }
      await writeMemory(memory, [...new Set([...entities, ...result.new_entities])])
      await log(book.id, kind, true, result.usage)
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      for (const row of rows) await markParagraph(row.id, 'failed')
      await log(bookId, kind, false, EMPTY_USAGE, err instanceof Error ? err.message : '生成失败')
    } finally {
      for (const row of rows) inflight.delete(row.id)
      touchPending()
      if (!signal.aborted && chapter === currentChapterId) {
        const fresh = await listParagraphs(chapter)
        ensure(fresh, lastOrder)
        await refresh(chapter)
      }
    }
  }

  function enqueueRefine(
    row: ParagraphRow,
    rows: ParagraphRow[],
    newEntities: string[],
    entities: string[],
    memoryBookId: string,
  ) {
    const index = rows.findIndex((item) => item.id === row.id) + 1
    scheduler.enqueue({
      kind: 'refine',
      key: row.id,
      distance: Math.max(0, row.order - lastOrder),
      run: (signal) => refineOne(row, rows, newEntities, entities, memoryBookId, index, signal),
    })
  }

  async function refineOne(
    row: ParagraphRow,
    rows: ParagraphRow[],
    newEntities: string[],
    entities: string[],
    memoryBookId: string,
    index: number,
    signal: AbortSignal,
  ) {
    try {
      const book = await getBook(currentBookId)
      if (!book || signal.aborted) return
      const { memory } = await readMemory(memoryBookId)
      const lineup = lineupFor(book.spoilerLevel, book.lineup)
      const block = toTextBlock(rows)
      const client = useSettingsStore().createClient()
      const result = await runRefine(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: formatMemoryForPrompt(memory),
          priorSummary: '',
          textUntilHot: formatBlock(block, index),
          pid: `p${index}`,
          hotReason: '粗评分为 3',
          residentState: formatMemoryForPrompt(memory),
          lineupText: fullLineup(lineup),
        },
        block,
        client,
        new Set(entities),
        newEntities,
        signal,
      )
      if (signal.aborted) return
      const comments = result.threads.map((thread) => ({
        ...commentFrom(thread.root),
        replies: thread.replies.map(commentFrom),
      }))
      await saveParagraphComments(row.id, comments, 3, 'refined')
      await writeMemory(applyMemoryUpdates(memory, result.memory_updates), entities)
      await log(book.id, 'refine', true, result.usage)
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      await markParagraph(row.id, 'failed')
      await log(currentBookId, 'refine', false, EMPTY_USAGE, err instanceof Error ? err.message : '精修失败')
    } finally {
      if (!signal.aborted) await refresh(currentChapterId)
    }
  }

  async function log(
    bookId: string,
    type: 'rough' | 'refine' | 'live',
    ok: boolean,
    usage: LlmUsage,
    error?: string,
  ) {
    await writeGenerationLog({
      bookId,
      type,
      ok,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cacheHitTokens: usage.cacheHitTokens,
      cost: estimateCost(usage, PRICING),
      error,
    })
  }

  return { needsKey, pendingIds, bind, stop, sync, retry }
})
