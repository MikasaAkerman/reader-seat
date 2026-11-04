import { defineStore } from 'pinia'
import { ref } from 'vue'
import { estimateCost, type LlmClient, type LlmUsage } from '@/core/llm'
import { EMPTY_USAGE } from '@/core/llm/types'
import {
  applyMemoryUpdates,
  mergeChapterSummary,
  noteUserStance,
  priorSummaryFrom,
  resolvePredictions,
  snapshotForPrompt,
} from '@/core/memory'
import { briefLineup, fullLineup, pickRepliers } from '@/core/personas'
import { canReroll, latestBatch, nextBatchNo } from '@/core/comments/batches'
import { formatBlock, commentPasses, runChapterTalk, runLiveReply, runPasserbyBatch, runRefine, runRough, runSpoilerCheck } from '@/core/generation'
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
import type { ReaderThread, StoredComment } from '@/db/repos/comments'
import {
  appendComment,
  commentsInBatch,
  listBatches,
  listThreads,
  markParagraph,
  markUserInterest,
  readMemory,
  saveNextBatch,
  saveParagraphComments,
  tasteExamplesFor,
  writeGenerationLog,
  writeMemory,
} from '@/db/repos/comments'
import { getBook, listChapters, listParagraphs, saveChapterSummary } from '@/db/repos/library'
import { addTalkReplies, readChapterTalk, saveChapterTalk, saveMicroReview } from '@/db/repos/notes'
import { createId } from '@/db/id'
import type { ChapterTalkRow, ParagraphRow } from '@/db/schema'
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

function findComment(
  threads: {
    id: string
    authorType: ReaderThread['authorType']
    role: string
    displayName: string
    text: string
    replies: { id: string; authorType: ReaderThread['authorType']; role: string; displayName: string; text: string }[]
  }[],
  id: string,
) {
  for (const thread of threads) {
    if (thread.id === id) return thread
    const reply = thread.replies.find((item) => item.id === id)
    if (reply) return reply
  }
  return undefined
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
  const replying = ref(false)
  const replyFailed = ref(false)
  const chapterTalk = ref<ChapterTalkRow | null>(null)
  const rerollMessage = ref('')
  const scheduler = new Scheduler()
  const inflight = new Set<string>()
  let listening = false
  let currentBookId = ''
  let currentChapterId = ''
  let lastOrder = 0
  let hasPlace = false
  let lastLive: {
    paragraphId: string
    userCommentId: string
    text: string
    parentId: string
    mention?: string
  } | null = null

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
          memorySnapshot: snapshotForPrompt(memory),
          priorSummary: await chapterSummary(book.id),
          blockText: formatBlock(block),
          knownEntities: entities,
          tasteExamples: await tasteExamplesFor(book.id),
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
      const hits = result.paragraphs.flatMap((item) => item.prediction_hits)
      await writeMemory(
        { ...memory, predictions: resolvePredictions(memory.predictions, hits) },
        [...new Set([...entities, ...result.new_entities])],
      )
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
          memorySnapshot: snapshotForPrompt(memory),
          priorSummary: await chapterSummary(book.id),
          textUntilHot: formatBlock(block, index),
          pid: `p${index}`,
          hotReason: '粗评分为 3',
          residentState: memory.stances.map((item) => `${item.role}：${item.stance}`).join('；'),
          lineupText: fullLineup(lineup),
          tasteExamples: await tasteExamplesFor(book.id),
        },
        block,
        client,
        new Set(entities),
        newEntities,
        signal,
      )
      if (signal.aborted) return
      const threads = await withoutSpoilers(book.spoilerLevel, formatBlock(block, index), result.threads, client, signal)
      if (signal.aborted) return
      const comments = threads.map((thread) => ({
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

  async function chapterSummary(bookId: string): Promise<string> {
    const chapters = await listChapters(bookId)
    const current = chapters.find((chapter) => chapter.id === currentChapterId)
    return priorSummaryFrom(chapters, current?.order ?? 1)
  }

  async function postComment(input: { paragraphId: string; text: string; parentId?: string; mention?: string }) {
    const text = input.text.trim()
    if (!text || !currentBookId) return
    replyFailed.value = false
    const id = await appendComment(
      input.paragraphId,
      { authorType: 'user', displayName: '我', role: '', text },
      input.parentId ?? '',
    )
    const loaded = await readMemory(currentBookId)
    await writeMemory(noteUserStance(loaded.memory, text), loaded.entities)
    await refresh(currentChapterId)
    lastLive = {
      paragraphId: input.paragraphId,
      userCommentId: id,
      text,
      parentId: input.parentId || id,
      mention: input.mention,
    }
    enqueueReply(lastLive)
  }

  function enqueueReply(request: NonNullable<typeof lastLive>) {
    replying.value = true
    scheduler.enqueue({
      kind: 'live',
      key: `reply:${request.userCommentId}`,
      distance: 0,
      run: (signal) => runReply(request, signal),
    })
  }

  function retryReply() {
    if (lastLive) enqueueReply(lastLive)
  }

  async function runReply(request: NonNullable<typeof lastLive>, signal: AbortSignal) {
    const bookId = currentBookId
    try {
      const settings = useSettingsStore()
      if (!settings.apiKey) {
        replyFailed.value = true
        return
      }
      const book = await getBook(bookId)
      if (!book || signal.aborted) return
      const rows = await listParagraphs(currentChapterId)
      const row = rows.find((item) => item.id === request.paragraphId)
      if (!row) return
      const until = rows.filter((item) => item.order <= row.order)
      const block = toTextBlock(until)
      const loaded = await readMemory(book.id)
      const threads = await listThreads(request.paragraphId)
      const spoken = threads.flatMap((thread) => [
        { authorType: thread.authorType, role: thread.role, displayName: thread.displayName },
        ...thread.replies.map((reply) => ({
          authorType: reply.authorType,
          role: reply.role,
          displayName: reply.displayName,
        })),
      ])
      const replyTo = findComment(threads, request.parentId)
      const repliers = pickRepliers({
        lineup: lineupFor(book.spoilerLevel, book.lineup),
        spoken,
        mention: request.mention,
        replyTo: replyTo && replyTo.authorType !== 'user' ? replyTo : undefined,
      })
      const client = settings.createClient()
      let gotReply = false
      let accepted = 0
      const limit = Math.max(repliers.length, 1)
      const result = await runLiveReply(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: snapshotForPrompt(loaded.memory),
          priorSummary: await chapterSummary(book.id),
          textUntilHere: formatBlock(block),
          userText: request.text,
          parentText: replyTo && replyTo.authorType !== 'user' ? replyTo.text : undefined,
          repliers: repliers.map((person) => ({
            role: person.role,
            displayName: person.displayName,
            voice: person.voice,
          })),
        },
        client,
        block,
        new Set(loaded.entities),
        async (reply) => {
          if (accepted >= limit) return
          accepted += 1
          gotReply = true
          await appendComment(request.paragraphId, commentFrom(reply), request.parentId)
          await refresh(currentChapterId)
        },
        signal,
      )
      if (signal.aborted) return
      replyFailed.value = !gotReply
      await log(book.id, 'live', gotReply, result.usage, gotReply ? undefined : '没有接上话')
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      replyFailed.value = true
      await log(bookId, 'live', false, EMPTY_USAGE, err instanceof Error ? err.message : '书友没接上话')
    } finally {
      replying.value = false
      if (!signal.aborted) await refresh(currentChapterId)
    }
  }

  async function finishChapter(chapterId: string) {
    if (needsKey.value || !currentBookId) return
    const chapters = await listChapters(currentBookId)
    const chapter = chapters.find((item) => item.id === chapterId)
    if (!chapter || chapter.summary) return
    scheduler.enqueue({
      kind: 'chapterTalk',
      key: chapterId,
      distance: 99,
      run: (signal) => runChapter(chapter, signal),
    })
  }

  async function runChapter(
    chapter: { id: string; title: string; order: number; summary?: string },
    signal: AbortSignal,
  ) {
    try {
      const book = await getBook(currentBookId)
      if (!book || signal.aborted) return
      const rows = await listParagraphs(chapter.id)
      const loaded = await readMemory(book.id)
      const client = useSettingsStore().createClient()
      const started = Date.now()
      const result = await runChapterTalk(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: snapshotForPrompt(loaded.memory),
          chapterTitle: chapter.title,
          readText: rows.map((row, index) => `p${index + 1} ${row.text}`).join('\n'),
        },
        client,
        signal,
      )
      if (signal.aborted) return
      await saveChapterSummary(chapter.id, mergeChapterSummary(chapter.summary, result.summary))
      const memory = applyMemoryUpdates(loaded.memory, result.memory_updates)
      memory.predictions = resolvePredictions(
        memory.predictions,
        result.prediction_updates.map((item) => ({ prediction_id: item.prediction_id, result: item.status })),
      )
      await writeMemory(memory, loaded.entities)
      const previous = await readChapterTalk(chapter.id)
      const hotParagraphIds = result.hot_paragraphs.flatMap((pid) => {
        const order = Number(pid.replace(/^p/i, ''))
        const row = rows[order - 1]
        return row ? [row.id] : []
      })
      await saveChapterTalk({
        id: previous?.id ?? createId(),
        bookId: book.id,
        chapterId: chapter.id,
        paragraphId: '',
        hotParagraphIds,
        residentLines: result.resident_lines
          .filter((line) => line.text.trim())
          .map((line) => ({ role: line.reader_role, text: line.text })),
        debates: result.debates.filter((item) => item.topic.trim() || item.summary.trim()),
        predictionUpdates: result.prediction_updates
          .filter((item) => item.prediction_id || item.status)
          .map((item) => ({ predictionId: item.prediction_id, status: item.status })),
        replies: previous?.replies ?? [],
        createdAt: previous?.createdAt ?? new Date().toISOString(),
      })
      if (chapter.id === currentChapterId) chapterTalk.value = (await readChapterTalk(chapter.id)) ?? null
      await log(book.id, 'chapterTalk', true, result.usage, undefined, Date.now() - started)
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      await log(currentBookId, 'chapterTalk', false, EMPTY_USAGE, err instanceof Error ? err.message : '章末整理失败')
    }
  }

  async function log(
    bookId: string,
    type: 'rough' | 'refine' | 'live' | 'chapterTalk' | 'spoilerCheck',
    ok: boolean,
    usage: LlmUsage,
    error?: string,
    latencyMs?: number,
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
      latencyMs,
    })
  }

  async function withoutSpoilers(
    spoilerLevel: string,
    text: string,
    threads: { root: RefineComment; replies: RefineComment[] }[],
    client: LlmClient,
    signal: AbortSignal,
  ) {
    const tagged = threads.map((thread, threadIndex) => ({
      rootId: `r${threadIndex}`,
      replyIds: thread.replies.map((_, replyIndex) => `r${threadIndex}-${replyIndex}`),
      thread,
    }))
    const comments = tagged.flatMap((item) => [
      { id: item.rootId, text: item.thread.root.text },
      ...item.thread.replies.map((reply, replyIndex) => ({ id: item.replyIds[replyIndex] ?? '', text: reply.text })),
    ])
    if (comments.length === 0) return threads
    const started = Date.now()
    try {
      const checked = await runSpoilerCheck(
        { spoilerLevel, priorSummary: await chapterSummary(currentBookId), text, comments },
        client,
        signal,
      )
      if (!signal.aborted) {
        await log(currentBookId, 'spoilerCheck', true, checked.usage, undefined, Date.now() - started)
      }
      return tagged
        .filter((item) => commentPasses(item.rootId, checked.results))
        .map((item) => ({
          root: item.thread.root,
          replies: item.thread.replies.filter((_, replyIndex) =>
            commentPasses(item.replyIds[replyIndex] ?? '', checked.results),
          ),
        }))
    } catch (err) {
      if (!isAbort(err) && !signal.aborted) {
        await log(
          currentBookId,
          'spoilerCheck',
          false,
          EMPTY_USAGE,
          err instanceof Error ? err.message : '校验失败',
          Date.now() - started,
        )
      }
      return threads
    }
  }

  async function loadTalk(chapterId: string) {
    chapterTalk.value = (await readChapterTalk(chapterId)) ?? null
  }

  async function markInteresting(paragraphId: string) {
    const rows = await listParagraphs(currentChapterId)
    const row = rows.find((item) => item.id === paragraphId)
    if (!row || row.kind === 'heading' || needsKey.value) return
    await markUserInterest(paragraphId)
    const { memory, entities } = await readMemory(currentBookId)
    scheduler.enqueue({
      kind: 'refine',
      key: row.id,
      distance: 0,
      run: (signal) => refineOne(row, [row], entities, entities, memory.bookId, 1, signal),
    })
  }

  async function reroll(paragraphId: string) {
    rerollMessage.value = ''
    if (needsKey.value || !currentBookId) return
    const batches = await listBatches(paragraphId)
    if (!canReroll(batches, new Date())) {
      rerollMessage.value = '这一段今天已经换过 3 次'
      return
    }
    const latest = latestBatch(batches)
    const paragraph = (await listParagraphs(currentChapterId)).find((item) => item.id === paragraphId)
    if (!latest || !paragraph) return
    const kept = (await commentsInBatch(latest.id)).filter((row) => row.authorType !== 'passerby')
    const client = useSettingsStore().createClient()
    const started = Date.now()
    try {
      const result = await runPasserbyBatch(
        {
          text: paragraph.text,
          kept: kept.map((row) => `${row.displayName}：${row.text}`).join('\n'),
        },
        client,
      )
      let seq = kept.length
      const passers = result.comments.map((comment) => ({
        id: createId(),
        batchId: '',
        paragraphId,
        parentId: '',
        authorType: 'passerby' as const,
        displayName: comment.display_name || '路人',
        role: '',
        text: comment.text,
        seq: seq++,
      }))
      await saveNextBatch(paragraphId, nextBatchNo(batches), [...kept, ...passers])
      await log(currentBookId, 'live', true, result.usage, undefined, Date.now() - started)
      await refresh(currentChapterId)
    } catch (err) {
      if (isAbort(err)) return
      rerollMessage.value = '没换成新的一批'
      await log(currentBookId, 'live', false, EMPTY_USAGE, err instanceof Error ? err.message : '换一批失败')
    }
  }

  async function submitMicro(input: { judgment: string; evidence: string; reservation: string }) {
    if (!currentBookId || !currentChapterId) return
    await saveMicroReview({ bookId: currentBookId, chapterId: currentChapterId, ...input })
    const book = await getBook(currentBookId)
    if (!book || needsKey.value) {
      await loadTalk(currentChapterId)
      return
    }
    const lineup = lineupFor(book.spoilerLevel, book.lineup)
    const repliers = pickRepliers({ lineup, spoken: [] }).filter((person) => person.authorType === 'resident')
    const extra = lineup.find((persona) => !repliers.some((person) => person.role === persona.role))
    if (repliers.length < 2 && extra) {
      repliers.push({
        authorType: 'resident',
        role: extra.role,
        displayName: extra.displayName,
        voice: extra.voiceSamples[0] ?? '',
      })
    }
    const rows = await listParagraphs(currentChapterId)
    const tail = rows.filter((row) => row.kind !== 'heading').slice(-3)
    const block = toTextBlock(tail.length > 0 ? tail : rows.slice(-1))
    const loaded = await readMemory(book.id)
    const replies: ChapterTalkRow['replies'] = []
    const client = useSettingsStore().createClient()
    replying.value = true
    try {
      await runLiveReply(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: snapshotForPrompt(loaded.memory),
          priorSummary: await chapterSummary(book.id),
          textUntilHere: formatBlock(block),
          userText: `判断：${input.judgment}\n证据：${input.evidence}\n保留：${input.reservation}`,
          repliers: repliers.map((person) => ({
            role: person.role,
            displayName: person.displayName,
            voice: person.voice,
          })),
        },
        client,
        block,
        new Set(loaded.entities),
        (reply) => {
          replies.push({ role: reply.reader_role || reply.display_name || '书友', text: reply.text })
        },
      )
      const existing = await readChapterTalk(currentChapterId)
      if (!existing) {
        await saveChapterTalk({
          id: createId(),
          bookId: book.id,
          chapterId: currentChapterId,
          paragraphId: '',
          hotParagraphIds: [],
          residentLines: [],
          debates: [],
          predictionUpdates: [],
          replies,
          createdAt: new Date().toISOString(),
        })
      } else {
        await addTalkReplies(currentChapterId, replies)
      }
    } finally {
      replying.value = false
      await loadTalk(currentChapterId)
    }
  }

  return {
    needsKey,
    pendingIds,
    replying,
    replyFailed,
    chapterTalk,
    rerollMessage,
    bind,
    stop,
    sync,
    retry,
    postComment,
    retryReply,
    finishChapter,
    loadTalk,
    markInteresting,
    reroll,
    submitMicro,
  }
})
