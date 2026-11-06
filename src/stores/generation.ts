import { defineStore } from 'pinia'
import { ref } from 'vue'
import { EMPTY_USAGE, estimateCost, type LlmClient, type LlmUsage } from '@/core/llm'
import {
  applyMemoryUpdates,
  mergeChapterSummary,
  mergeSynopsis,
  noteUserStance,
  priorSummaryFrom,
  resolvePredictions,
  snapshotForPrompt,
} from '@/core/memory'
import { briefLineup, dialogueSpeaker, fullLineup, pickRepliers, samplePassersby, voiceSamplesOf } from '@/core/personas'
import { canReroll, latestBatch, nextBatchNo, rowsToCarry } from '@/core/comments/batches'
import {
  assignObservations,
  commentPasses,
  filterByEntityRule,
  formatBlock,
  maxPicks,
  runBackground,
  runChapterTalk,
  runDeep,
  runDeepPlan,
  runDialogue,
  runLiveReply,
  runObserve,
  runPasserbyBatch,
  runRefine,
  runSpoilerCheck,
  runVoice,
  type AssignedSlot,
} from '@/core/generation'
import { stationLensOf } from '@/core/stations'
import { addDropped, emptyDropped, isNearDuplicate, type DroppedCounts, type Passage } from '@/core/quality'
import {
  CONTEXT_BUDGET,
  chapterDigest,
  entitiesForPrompt,
  laterNames,
  precedingText,
  tailWithin,
  textBlockOf,
} from '@/core/generation/context'
import {
  blockIndex,
  BUFFER_LOW,
  BUFFER_TARGET,
  COLD_BLOCK_PARAS,
  HOT_LIMIT,
  deepSpotRange,
  generatesShort,
  jumpBlock,
  lineupFor,
  planNextBlock,
  readyAhead,
  toTextBlock,
} from '@/core/generation/pipeline'
import { pidToIndex, type RefineComment } from '@/core/generation/schema'
import { Scheduler } from '@/core/scheduler'
import type { ReaderThread, StoredComment } from '@/db/repos/comments'
import {
  appendComment,
  commentsInBatch,
  listBatches,
  listDeepSpots,
  listObservationsFor,
  listRecentAngles,
  listRecentCommentTexts,
  listThreads,
  markParagraph,
  markUserInterest,
  readMemory,
  replaceObservations,
  replacePinned,
  saveDeepSpots,
  saveNextBatch,
  saveParagraphComments,
  tasteExamplesFor,
  updateDeepSpot,
  updateMemory,
  writeGenerationLog,
  type MemoryState,
} from '@/db/repos/comments'
import { createId } from '@/db/id'
import type { BookRow, ChapterRow, ChapterTalkRow, DeepSpotRow, ObservationRow, ParagraphRow } from '@/db/schema'
import { getBook, listChapters, listParagraphs, saveChapterSummary } from '@/db/repos/library'
import { addTalkReplies, readChapterTalk, saveChapterTalk, saveMicroReview } from '@/db/repos/notes'
import { useSettingsStore } from '@/stores/settings'
import { useCommentsStore } from '@/stores/comments'

/** 每章最多手动标几段"有意思" */
export const INTEREST_LIMIT_PER_CHAPTER = 5

type LogType = 'rough' | 'refine' | 'live' | 'chapterTalk' | 'spoilerCheck' | 'deep' | 'background'

const DEEP_AHEAD = 40

/** 任务入队时记下的位置。任务跑完时用户可能已经换了章、换了书。 */
interface Place {
  bookId: string
  chapterId: string
}

interface LiveRequest {
  place: Place
  paragraphId: string
  userCommentId: string
  text: string
  parentId: string
  mention?: string
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

function dropNotice(dropped: DroppedCounts, fallback: string): string {
  if (dropped.spoiler > 0) return '没能通过剧透校验'
  if (dropped.entity > 0) return '提到了还没读到的名字'
  if (dropped.quote > 0) return '引文对不上原文'
  if (dropped.outside > 0) return '用了文本外的情节'
  if (dropped.duplicate > 0) return '和已有评论太像'
  return fallback
}

function findComment(threads: ReaderThread[], id: string) {
  for (const thread of threads) {
    if (thread.id === id) return thread
    const reply = thread.replies.find((item) => item.id === id)
    if (reply) return reply
  }
  return undefined
}

type FoldedThread<T extends { root: RefineComment; replies: RefineComment[] }> = Omit<T, 'root' | 'replies'> & {
  root: RefineComment & { folded?: boolean }
  replies: Array<RefineComment & { folded?: boolean }>
}

function commentFrom(comment: RefineComment & { folded?: boolean }): StoredComment {
  const resident = comment.author_type === 'resident'
  return {
    authorType: comment.author_type,
    displayName: resident ? comment.reader_role || comment.display_name || '书友' : comment.display_name || '路人',
    role: comment.reader_role || '',
    text: comment.text,
    ...(comment.folded ? { folded: true } : {}),
  }
}

function slotComment(slot: AssignedSlot, text: string): StoredComment {
  return {
    authorType: slot.authorType,
    displayName: slot.displayName,
    role: slot.readerRole,
    text,
  }
}

function rowAt<T>(rows: T[], pid: string): T | undefined {
  try {
    return rows[pidToIndex(pid) - 1]
  } catch {
    return undefined
  }
}

function unionEntities(current: string[], extra: string[]): string[] {
  const seen = new Set(current)
  const out = [...current]
  for (const name of extra) {
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export const useGenerationStore = defineStore('generation', () => {
  const needsKey = ref(false)
  const pendingIds = ref<string[]>([])
  const replying = ref(false)
  const replyFailed = ref(false)
  const chapterTalk = ref<ChapterTalkRow | null>(null)
  const rerollMessage = ref('')
  const notice = ref('')
  const scheduler = new Scheduler()
  const inflight = new Set<string>()
  /** 不走调度器的直接调用（换一批、微评回应），停下时一起中止。 */
  const sideCalls = new Set<AbortController>()
  let listening = false
  let currentBookId = ''
  let currentChapterId = ''
  let lastOrder = 0
  let hasPlace = false
  /** 冷启动：刚进章节或刚跳读，缓冲还不够。第一块小一点，粗评并发放到 2。 */
  let cold = false
  let smallFirst = false
  let refreshTimer: ReturnType<typeof setTimeout> | 0 = 0
  let lastLive: LiveRequest | null = null
  let allowShort = true
  let spotRange = { min: 1, max: 1 }

  async function refreshGates(bookId: string) {
    const book = await getBook(bookId)
    allowShort = !book || generatesShort(book)
    spotRange = book ? deepSpotRange(book) : { min: 1, max: 1 }
  }

  function here(): Place {
    return { bookId: currentBookId, chapterId: currentChapterId }
  }

  function touchPending() {
    pendingIds.value = [...inflight]
  }

  function forgetQueued() {
    for (const id of scheduler.dropPending(['rough', 'refine', 'deep'])) inflight.delete(id)
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
    for (const controller of sideCalls) controller.abort()
    sideCalls.clear()
    inflight.clear()
    touchPending()
    hasPlace = false
    cold = false
    smallFirst = false
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = 0
    }
  }

  async function refresh(chapterId: string) {
    if (chapterId !== currentChapterId) return
    await useCommentsStore().loadChapter(chapterId, inflight)
  }

  /** 流式落库时一段一刷太频繁，合并到一次。 */
  function scheduleRefresh(chapterId: string) {
    if (chapterId !== currentChapterId || refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = 0
      void refresh(currentChapterId)
    }, 150)
  }

  async function sync(input: { bookId: string; chapterId: string; order: number }) {
    bind()
    await refreshGates(input.bookId)
    const settings = useSettingsStore()
    if (!settings.loaded) await settings.load()
    needsKey.value = !settings.apiKey
    currentBookId = input.bookId
    const place: Place = { bookId: input.bookId, chapterId: input.chapterId }
    const paragraphs = await listParagraphs(input.chapterId)
    if (input.chapterId !== currentChapterId) {
      currentChapterId = input.chapterId
      lastOrder = input.order
      hasPlace = true
      forgetQueued()
      cold = true
      smallFirst = true
    } else if (hasPlace) {
      const jump = blockIndex(paragraphs, input.order) - blockIndex(paragraphs, lastOrder)
      const previous = lastOrder
      lastOrder = input.order
      if (jump > 2 && input.order !== previous) {
        forgetQueued()
        cold = true
        smallFirst = false
        enqueueJump(paragraphs, input.order, place)
      }
    } else {
      lastOrder = input.order
      hasPlace = true
      cold = true
      smallFirst = true
    }
    await refresh(input.chapterId)
    if (needsKey.value) return
    recoverRefining(paragraphs, place)
    ensure(paragraphs, input.order, place)
    enqueueDeepWork(paragraphs, place, input.order)
  }

  function ensure(rows: ParagraphRow[], order: number, place: Place) {
    if (!allowShort || needsKey.value || place.chapterId !== currentChapterId) return
    let covered = readyAhead(rows, order, inflight)
    if (covered >= BUFFER_LOW) {
      cold = false
      scheduler.setLimit('rough', 1)
      return
    }
    scheduler.setLimit('rough', cold ? 2 : 1)
    let cursor = order
    for (let guard = 0; covered < BUFFER_TARGET && guard < 8; guard++) {
      const block = planNextBlock(rows, cursor, inflight, smallFirst ? COLD_BLOCK_PARAS : undefined)
      if (!block || block.length === 0) break
      smallFirst = false
      const last = block[block.length - 1]
      if (!last) break
      for (const row of block) inflight.add(row.id)
      scheduler.enqueue({
        kind: 'rough',
        key: block.map((row) => row.id).join(','),
        distance: Math.max(0, block[0]!.order - order),
        run: (signal) => runBlock(block, 'rough', place, signal),
      })
      covered += block.length
      cursor = last.order + 1
    }
    touchPending()
  }

  function enqueueJump(rows: ParagraphRow[], order: number, place: Place) {
    if (!allowShort) return
    const block = jumpBlock(rows, order, inflight)
    if (block.length === 0) return
    for (const row of block) inflight.add(row.id)
    scheduler.enqueue({
      kind: 'live',
      key: block.map((row) => row.id).join(','),
      distance: 0,
      droppable: true,
      run: (signal) => runBlock(block, 'live', place, signal),
    })
    touchPending()
  }

  /** 精修排过队但没跑完（切章、跳读、重启）的热段，重新入队。调度器按 key 去重。 */
  function recoverRefining(rows: ParagraphRow[], place: Place) {
    if (!allowShort) return
    for (const row of rows) {
      if (row.genStatus !== 'refining') continue
      enqueueRefine(row, place, row.userMarked === 'interesting' ? '读者标记为有意思' : '粗评分为 3')
    }
  }

  async function retry(paragraphId: string) {
    if (!allowShort) return
    const place = here()
    const rows = await listParagraphs(place.chapterId)
    const row = rows.find((item) => item.id === paragraphId)
    if (!row) return
    await markParagraph(paragraphId, 'none', null)
    row.genStatus = 'none'
    inflight.delete(paragraphId)
    enqueueJump(rows, row.order, place)
    ensure(rows, lastOrder || row.order, place)
    await refresh(place.chapterId)
  }

  async function priorSummary(place: Place, memory: MemoryState): Promise<string> {
    const chapters = await listChapters(place.bookId)
    const current = chapters.find((chapter) => chapter.id === place.chapterId)
    const order = current?.order ?? 0
    // 梗概覆盖到当前章或更后面时（回头重读），用它会剧透。
    const synopsis = memory.synopsisThrough >= 0 && memory.synopsisThrough < order ? memory.synopsis : ''
    return priorSummaryFrom(chapters, order, synopsis)
  }

  async function neighborChapterIds(place: Place): Promise<string[]> {
    const chapters = await listChapters(place.bookId)
    const current = chapters.find((chapter) => chapter.id === place.chapterId)
    const previous = chapters.filter((chapter) => chapter.order < (current?.order ?? 0)).sort((a, b) => b.order - a.order)[0]
    return [place.chapterId, previous?.id].filter((id): id is string => Boolean(id))
  }

  async function passageCorpus(place: Place, beforeOrder: number): Promise<Passage[]> {
    const chapters = await listChapters(place.bookId)
    const current = chapters.find((chapter) => chapter.id === place.chapterId)
    const earlier = chapters.filter((chapter) => chapter.order < (current?.order ?? 0)).sort((a, b) => b.order - a.order).slice(0, 3)
    const out: Passage[] = []
    for (const chapter of earlier) {
      const rows = await listParagraphs(chapter.id)
      for (const row of rows) {
        if (row.kind === 'heading' || !row.text.trim()) continue
        out.push({ text: row.text, chapterTitle: chapter.title, score: 0 })
      }
    }
    const here = await listParagraphs(place.chapterId)
    for (const row of here) {
      if (row.order >= beforeOrder || row.kind === 'heading' || !row.text.trim()) continue
      out.push({ text: row.text, chapterTitle: current?.title, score: 0 })
    }
    return out
  }

  async function runBlock(rows: ParagraphRow[], kind: 'rough' | 'live', place: Place, signal: AbortSignal) {
    const started = Date.now()
    const saved = new Set<string>()
    const dropped = emptyDropped()
    try {
      if (rows.every((row) => row.kind === 'heading')) {
        for (const row of rows) await saveParagraphComments(row.id, [], 0, 'rough')
        return
      }
      const book = await getBook(place.bookId)
      if (!book || signal.aborted) return
      const memory = await readMemory(book.id)
      const lineup = lineupFor(book.spoilerLevel, book.lineup)
      const block = toTextBlock(rows)
      const chapterRows = await listParagraphs(place.chapterId)
      const prior = await priorSummary(place, memory)
      const before = precedingText(chapterRows, rows[0]!.order, CONTEXT_BUDGET.roughBefore)
      const snapshot = snapshotForPrompt(memory.memory)
      const client = useSettingsStore().createClient()
      const chapterIds = await neighborChapterIds(place)
      const [recentAngles, recentComments, passages] = await Promise.all([
        listRecentAngles(chapterIds),
        listRecentCommentTexts(chapterIds),
        passageCorpus(place, rows[0]!.order),
      ])
      const samples = voiceSamplesOf(lineup)
      const observe = await runObserve(
        {
          title: book.title,
          author: book.author,
          translator: book.translator,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: snapshot,
          priorSummary: prior,
          beforeText: before,
          blockText: formatBlock(block),
          knownEntities: entitiesForPrompt(
            memory.entities,
            [before, formatBlock(block), snapshot, prior].join('\n'),
            CONTEXT_BUDGET.promptEntities,
          ),
          tasteExamples: await tasteExamplesFor(book.id),
          lineupText: briefLineup(lineup),
          recentAngles: recentAngles.join('；'),
          maxPicks: maxPicks(rows.length),
          paragraphCount: rows.length,
        },
        client,
        signal,
      )
      if (signal.aborted) return
      const assigned = assignObservations({
        result: observe,
        block,
        lineup,
        recentAngles,
        passages,
        seed: `${place.chapterId}:${rows[0]?.id ?? ''}`,
        hotLimit: HOT_LIMIT,
      })
      Object.assign(dropped, assigned.dropped)
      const observationRows: ObservationRow[] = assigned.slots.map((slot) => ({
        id: createId(),
        bookId: book.id,
        chapterId: place.chapterId,
        paragraphId: rowAt(rows, slot.pid)?.id ?? '',
        oid: slot.oid,
        kind: slot.kind,
        quote: slot.quote,
        point: slot.point,
        echoText: slot.echoText,
        assignedRole: slot.readerRole,
        assignedName: slot.displayName,
        authorType: slot.authorType,
        createdAt: new Date().toISOString(),
      }))
      await replaceObservations(
        rows.map((row) => row.id),
        observationRows.filter((row) => row.paragraphId),
      )

      const byParagraph = new Map<string, StoredComment[]>()
      let chain = Promise.resolve()
      const flush = (row: ParagraphRow, comments: StoredComment[], score: number, hot: boolean) => {
        chain = chain.then(async () => {
          if (signal.aborted) return
          await saveParagraphComments(row.id, comments, score, hot ? 'refining' : 'rough')
          saved.add(row.id)
          inflight.delete(row.id)
          touchPending()
          if (hot) enqueueRefine(row, place, score === 3 ? '观察步骤评为热段' : '粗评分为 3')
          scheduleRefresh(place.chapterId)
        })
      }

      const voice = await runVoice(
        assigned.slots,
        [...samples, ...recentComments].join('\n'),
        client,
        block,
        new Set(memory.entities),
        assigned.newEntities,
        samples,
        [...samples, ...recentComments],
        (item) => {
          const row = rowAt(rows, item.slot.pid)
          if (!row) return
          const list = byParagraph.get(row.id) ?? []
          list.push(slotComment(item.slot, item.line.text))
          byParagraph.set(row.id, list)
          flush(row, list, item.slot.hot ? 3 : item.slot.score, item.slot.hot)
        },
        signal,
      )
      Object.assign(dropped, addDropped(dropped, voice.dropped))
      await chain
      if (signal.aborted) return

      const hotSet = new Set(assigned.hotPids)
      for (const row of rows) {
        if (saved.has(row.id)) continue
        const slot = assigned.slots.find((item) => rowAt(rows, item.pid)?.id === row.id)
        const hot = slot?.hot || (slot ? hotSet.has(slot.pid) : false)
        await saveParagraphComments(row.id, [], hot ? 3 : 0, hot ? 'refining' : 'rough')
        saved.add(row.id)
        if (hot) enqueueRefine(row, place, '观察步骤评为热段')
      }

      const hits = assigned.paragraphs.flatMap((item) => item.prediction_hits)
      await updateMemory(book.id, (state) => ({
        ...state,
        memory: { ...state.memory, predictions: resolvePredictions(state.memory.predictions, hits) },
        entities: unionEntities(state.entities, assigned.newEntities),
      }))
      const usage = {
        promptTokens: observe.usage.promptTokens + voice.usage.promptTokens,
        completionTokens: observe.usage.completionTokens + voice.usage.completionTokens,
        cacheHitTokens: observe.usage.cacheHitTokens + voice.usage.cacheHitTokens,
        reasoningTokens: observe.usage.reasoningTokens + voice.usage.reasoningTokens,
      }
      await log(book.id, kind === 'live' ? 'live' : 'rough', true, usage, undefined, Date.now() - started, { dropped })
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      for (const row of rows) {
        if (!saved.has(row.id)) await markParagraph(row.id, 'failed')
      }
      await log(place.bookId, kind, false, EMPTY_USAGE, errorText(err, '生成失败'), Date.now() - started)
    } finally {
      for (const row of rows) inflight.delete(row.id)
      touchPending()
      if (!signal.aborted && place.chapterId === currentChapterId) {
        const fresh = await listParagraphs(place.chapterId)
        ensure(fresh, lastOrder, place)
        enqueueDeepWork(fresh, place, lastOrder)
        await refresh(place.chapterId)
      }
    }
  }

  /** 读者前方的热段按距离排；已经读过去的排在后面。 */
  function refineDistance(row: ParagraphRow, place: Place): number {
    if (place.chapterId !== currentChapterId) return 999
    return row.order >= lastOrder ? row.order - lastOrder : 100 + lastOrder - row.order
  }

  function enqueueRefine(row: ParagraphRow, place: Place, reason: string) {
    scheduler.enqueue({
      kind: 'refine',
      key: row.id,
      distance: refineDistance(row, place),
      run: (signal) => refineOne(row.id, place, reason, signal),
    })
  }

  async function refineOne(paragraphId: string, place: Place, reason: string, signal: AbortSignal) {
    const started = Date.now()
    try {
      const book = await getBook(place.bookId)
      if (!book || signal.aborted) return
      const rows = await listParagraphs(place.chapterId)
      const row = rows.find((item) => item.id === paragraphId)
      if (!row) return
      const memory = await readMemory(book.id)
      const lineup = lineupFor(book.spoilerLevel, book.lineup)
      const context = tailWithin(
        rows.filter((item) => item.order <= row.order),
        CONTEXT_BUDGET.refineUntilHot,
      )
      const block = textBlockOf(context)
      const index = context.length
      const prior = await priorSummary(place, memory)
      const snapshot = snapshotForPrompt(memory.memory)
      const later = laterNames(
        memory.entities,
        rows.filter((item) => item.order <= row.order).map((item) => item.text).join(''),
        rows.filter((item) => item.order > row.order).map((item) => item.text).join(''),
        prior + snapshot,
      )
      const client = useSettingsStore().createClient()
      const observations = await listObservationsFor(row.id)
      const chapterIds = await neighborChapterIds(place)
      const recentComments = await listRecentCommentTexts(chapterIds)
      const samples = voiceSamplesOf(lineup)
      const assignments = observations
        .map((item) => `${item.assignedName} | ${item.kind} | ${item.point} | 引文：${item.quote}${item.echoText ? ` | 前文：${item.echoText}` : ''}`)
        .join('\n')
      const result = await runRefine(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: snapshot,
          priorSummary: prior,
          textUntilHot: formatBlock(block, index),
          pid: `p${index}`,
          hotReason: reason,
          residentState: memory.memory.stances.map((item) => `${item.role}：${item.stance}`).join('；'),
          lineupText: fullLineup(lineup),
          tasteExamples: await tasteExamplesFor(book.id),
          assignments,
          recentComments: [...samples, ...recentComments].join('\n'),
        },
        block,
        client,
        new Set(memory.entities.filter((name) => !later.includes(name))),
        later,
        observations.map((item) => item.quote),
        [...samples, ...recentComments],
        signal,
      )
      if (signal.aborted) return
      const threads = await withoutSpoilers(
        place.bookId,
        book.spoilerLevel,
        prior,
        formatBlock(block, index),
        result.threads,
        client,
        signal,
      )
      if (signal.aborted) return
      if (!threads || threads.length === 0) {
        // 严格档校验请求失败，或精修本身没写出评论：保留粗评占位。
        await markParagraph(row.id, 'rough', 3)
      } else {
        await saveParagraphComments(
          row.id,
          threads.map((thread) => ({ ...commentFrom(thread.root), replies: thread.replies.map(commentFrom) })),
          3,
          'refined',
        )
      }
      await updateMemory(book.id, (state) => ({
        ...state,
        memory: applyMemoryUpdates(state.memory, result.memory_updates),
      }))
      await log(book.id, 'refine', true, result.usage, undefined, Date.now() - started, { dropped: result.dropped })
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      await markParagraph(paragraphId, 'failed')
      await log(place.bookId, 'refine', false, EMPTY_USAGE, errorText(err, '精修失败'), Date.now() - started)
    } finally {
      if (!signal.aborted) await refresh(place.chapterId)
    }
  }

  /**
   * 二次剧透校验。返回 null 表示严格档位下校验请求失败，调用方应当不采用这批结果。
   * 某一条没通过时不丢弃，给它标上 folded，界面默认折叠。
   * 严格档位下，校验结果里漏掉的评论也按不通过、折叠处理。
   */
  async function withoutSpoilers<T extends { root: RefineComment; replies: RefineComment[] }>(
    bookId: string,
    spoilerLevel: string,
    prior: string,
    text: string,
    threads: T[],
    client: LlmClient,
    signal: AbortSignal,
  ): Promise<Array<FoldedThread<T>> | null> {
    if (spoilerLevel === '全开放') return threads
    const strict = spoilerLevel === '严格'
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
      const checked = await runSpoilerCheck({ spoilerLevel, priorSummary: prior, text, comments }, client, signal)
      if (!signal.aborted) await log(bookId, 'spoilerCheck', true, checked.usage, undefined, Date.now() - started)
      return tagged.map((item) => ({
        ...item.thread,
        root: {
          ...item.thread.root,
          ...(commentPasses(item.rootId, checked.results, strict) ? {} : { folded: true as const }),
        },
        replies: item.thread.replies.map((reply, replyIndex) => ({
          ...reply,
          ...(commentPasses(item.replyIds[replyIndex] ?? '', checked.results, strict) ? {} : { folded: true as const }),
        })),
      }))
    } catch (err) {
      if (isAbort(err) || signal.aborted) return null
      await log(bookId, 'spoilerCheck', false, EMPTY_USAGE, errorText(err, '校验失败'), Date.now() - started)
      return strict ? null : threads
    }
  }

  /** 单条评论的剧透校验。blocked 表示严格档请求失败；folded 是应折叠的下标。 */
  async function spoilerMarks(
    bookId: string,
    spoilerLevel: string,
    prior: string,
    text: string,
    lines: string[],
    client: LlmClient,
    signal: AbortSignal,
  ): Promise<{ blocked: boolean; folded: Set<number> }> {
    const clear = { blocked: false, folded: new Set<number>() }
    if (spoilerLevel !== '严格' || lines.length === 0) return clear
    const threads = lines.map((line, index) => ({
      index,
      root: { author_type: 'resident' as const, text: line, uses_outside_plot: false },
      replies: [] as RefineComment[],
    }))
    const kept = await withoutSpoilers(bookId, spoilerLevel, prior, text, threads, client, signal)
    if (!kept) return { blocked: true, folded: new Set() }
    return {
      blocked: false,
      folded: new Set(kept.flatMap((thread) => (thread.root.folded ? [thread.index] : []))),
    }
  }

  async function postComment(input: { paragraphId: string; text: string; parentId?: string; mention?: string }) {
    const text = input.text.trim()
    if (!text || !currentBookId) return
    const place = here()
    replyFailed.value = false
    const id = await appendComment(
      input.paragraphId,
      { authorType: 'user', displayName: '我', role: '', text },
      input.parentId ?? '',
    )
    await updateMemory(place.bookId, (state) => ({ ...state, memory: noteUserStance(state.memory, text) }))
    await refresh(place.chapterId)
    lastLive = {
      place,
      paragraphId: input.paragraphId,
      userCommentId: id,
      text,
      parentId: input.parentId || id,
      mention: input.mention,
    }
    enqueueReply(lastLive)
  }

  function enqueueReply(request: LiveRequest) {
    if (!allowShort) return
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

  async function runReply(request: LiveRequest, signal: AbortSignal) {
    const { place } = request
    const started = Date.now()
    try {
      const settings = useSettingsStore()
      if (!settings.apiKey) {
        replyFailed.value = true
        return
      }
      const book = await getBook(place.bookId)
      if (!book || signal.aborted) return
      const rows = await listParagraphs(place.chapterId)
      const row = rows.find((item) => item.id === request.paragraphId)
      if (!row) return
      const upTo = rows.filter((item) => item.order <= row.order)
      const block = textBlockOf(tailWithin(upTo, CONTEXT_BUDGET.replyBefore))
      const memory = await readMemory(book.id)
      const prior = await priorSummary(place, memory)
      const snapshot = snapshotForPrompt(memory.memory)
      const later = laterNames(
        memory.entities,
        upTo.map((item) => item.text).join(''),
        rows.filter((item) => item.order > row.order).map((item) => item.text).join(''),
        prior + snapshot,
      )
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
      const parent = replyTo && replyTo.authorType !== 'user' ? replyTo : undefined
      const lineup = lineupFor(book.spoilerLevel, book.lineup)
      const client = settings.createClient()
      const known = new Set(memory.entities.filter((name) => !later.includes(name)))
      if (!request.mention) {
        const speaker = dialogueSpeaker(lineup, parent)
        const generated = await runDialogue(
          {
            title: book.title,
            spoilerLevel: book.spoilerLevel,
            memorySnapshot: snapshot,
            priorSummary: prior,
            textUntilHere: formatBlock(block),
            userText: request.text,
            parentText: parent?.text,
            speakerName: speaker.displayName,
            speakerVoice: speaker.voice,
          },
          client,
          block,
          known,
          signal,
          later,
        )
        if (signal.aborted) return
        const answered = Boolean(generated.text)
        if (generated.text) {
          await appendComment(
            request.paragraphId,
            {
              authorType: speaker.authorType,
              displayName: speaker.displayName,
              role: speaker.role,
              text: generated.text,
            },
            request.parentId,
          )
        }
        replyFailed.value = !answered
        await log(book.id, 'live', answered, generated.usage, answered ? undefined : '没有接上话', Date.now() - started)
        return
      }
      const repliers = pickRepliers({ lineup, spoken, mention: request.mention, replyTo: parent })
      let gotReply = false
      let accepted = 0
      const limit = Math.max(repliers.length, 1)
      let chain = Promise.resolve()
      const result = await runLiveReply(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: snapshot,
          priorSummary: prior,
          textUntilHere: formatBlock(block),
          userText: request.text,
          parentText: parent?.text,
          repliers: repliers.map((person) => ({
            role: person.role,
            displayName: person.displayName,
            voice: person.voice,
          })),
        },
        client,
        block,
        known,
        (reply) => {
          if (accepted >= limit) return
          accepted += 1
          gotReply = true
          chain = chain.then(async () => {
            await appendComment(request.paragraphId, commentFrom(reply), request.parentId)
            await refresh(place.chapterId)
          })
        },
        signal,
        later,
        [
          ...voiceSamplesOf(lineup),
          ...threads.flatMap((thread) => [thread.text, ...thread.replies.map((reply) => reply.text)]),
        ],
      )
      await chain
      if (signal.aborted) return
      replyFailed.value = !gotReply
      await log(book.id, 'live', gotReply, result.usage, gotReply ? undefined : '没有接上话', Date.now() - started)
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      replyFailed.value = true
      await log(place.bookId, 'live', false, EMPTY_USAGE, errorText(err, '书友没接上话'), Date.now() - started)
    } finally {
      replying.value = false
      if (!signal.aborted) await refresh(place.chapterId)
    }
  }

  async function finishChapter(chapterId: string) {
    if (needsKey.value || !currentBookId) return
    const place: Place = { bookId: currentBookId, chapterId }
    const chapters = await listChapters(place.bookId)
    const chapter = chapters.find((item) => item.id === chapterId)
    if (!chapter || chapter.summary) return
    scheduler.enqueue({
      kind: 'chapterTalk',
      key: chapterId,
      distance: 99,
      run: (signal) => runChapter(chapter, place, signal),
    })
  }

  async function runChapter(chapter: ChapterRow, place: Place, signal: AbortSignal) {
    const started = Date.now()
    try {
      const book = await getBook(place.bookId)
      if (!book || signal.aborted) return
      const rows = await listParagraphs(chapter.id)
      const chapters = await listChapters(place.bookId)
      const memory = await readMemory(book.id)
      const settings = useSettingsStore()
      const client = settings.createClient()
      const usable = memory.synopsisThrough >= 0 && memory.synopsisThrough < chapter.order
      const readText = chapterDigest(rows, CONTEXT_BUDGET.chapterTalkFull)
      const result = await runChapterTalk(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: snapshotForPrompt(memory.memory),
          synopsis: usable ? memory.synopsis : '',
          chapterTitle: chapter.title,
          readText,
        },
        client,
        signal,
        settings.chapterReasoning ? 'low' : 'off',
      )
      if (signal.aborted) return
      const lines = result.resident_lines.filter((line) => line.text.trim())
      const marks = await spoilerMarks(
        book.id,
        book.spoilerLevel,
        usable ? memory.synopsis : '',
        readText,
        lines.map((line) => line.text),
        client,
        signal,
      )
      if (signal.aborted) return
      await saveChapterSummary(chapter.id, mergeChapterSummary(chapter.summary, result.summary))
      // 只有读到最远的一章才推进梗概；回头补读更早的章节不改它。
      const furthest = chapters.every((item) => item.order <= chapter.order || !item.summary)
      await updateMemory(book.id, (state) => {
        const next = applyMemoryUpdates(state.memory, result.memory_updates)
        next.predictions = resolvePredictions(
          next.predictions,
          result.prediction_updates.map((item) => ({ prediction_id: item.prediction_id, result: item.status })),
        )
        const advance = furthest && chapter.order > state.synopsisThrough && result.synopsis_update.trim()
        return {
          ...state,
          memory: next,
          synopsis: advance ? mergeSynopsis(state.synopsis, result.synopsis_update) : state.synopsis,
          synopsisThrough: advance ? chapter.order : state.synopsisThrough,
        }
      })
      const previous = await readChapterTalk(chapter.id)
      const sorted = [...rows].sort((a, b) => a.order - b.order)
      const hotParagraphIds = result.hot_paragraphs.flatMap((pid) => {
        const order = Number(pid.replace(/^p/i, ''))
        const row = sorted[order - 1]
        return row ? [row.id] : []
      })
      await saveChapterTalk({
        id: previous?.id ?? createId(),
        bookId: book.id,
        chapterId: chapter.id,
        paragraphId: '',
        hotParagraphIds,
        residentLines: marks.blocked
          ? []
          : lines.map((line, index) => ({
              role: line.reader_role,
              text: line.text,
              ...(marks.folded.has(index) ? { folded: true } : {}),
            })),
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
      await log(place.bookId, 'chapterTalk', false, EMPTY_USAGE, errorText(err, '章末整理失败'), Date.now() - started)
    }
  }

  async function log(
    bookId: string,
    type: LogType,
    ok: boolean,
    usage: LlmUsage,
    error?: string,
    latencyMs?: number,
    extra: { dropped?: DroppedCounts; model?: string } = {},
  ) {
    const settings = useSettingsStore()
    await writeGenerationLog({
      bookId,
      type,
      ok,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cacheHitTokens: usage.cacheHitTokens,
      reasoningTokens: usage.reasoningTokens,
      cost: estimateCost(usage, settings.pricing),
      error,
      latencyMs,
      dropped: extra.dropped,
      model: extra.model || settings.model,
    })
  }

  async function loadTalk(chapterId: string) {
    chapterTalk.value = (await readChapterTalk(chapterId)) ?? null
  }

  function enqueueDeepWork(rows: ParagraphRow[], place: Place, order: number) {
    if (spotRange.max <= 0 || needsKey.value) return
    scheduler.enqueue({
      kind: 'deep',
      key: `plan:${place.chapterId}`,
      distance: 80,
      run: (signal) => planDeep(rows, place, signal),
    })
    void listDeepSpots(place.chapterId).then((spots) => {
      for (const spot of spots) {
        if (spot.status !== 'planned') continue
        if (spot.endOrder > order + DEEP_AHEAD) continue
        scheduler.enqueue({
          kind: 'deep',
          key: spot.id,
          distance: Math.max(0, spot.endOrder - order),
          run: async (signal) => {
            await generateDeep(spot.id, place, signal)
          },
        })
      }
    })
  }

  async function planDeep(rows: ParagraphRow[], place: Place, signal: AbortSignal) {
    const existing = await listDeepSpots(place.chapterId)
    if (existing.length > 0) return
    const settings = useSettingsStore()
    const started = Date.now()
    try {
      const book = await getBook(place.bookId)
      if (!book || signal.aborted) return
      const range = deepSpotRange(book)
      if (range.max <= 0) return
      const memory = await readMemory(book.id)
      const chapters = await listChapters(place.bookId)
      const chapter = chapters.find((item) => item.id === place.chapterId)
      const client = settings.createClient()
      const result = await runDeepPlan(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          chapterTitle: chapter?.title || '',
          synopsis: memory.synopsisThrough >= 0 && memory.synopsisThrough < (chapter?.order ?? 0) ? memory.synopsis : '',
          priorSummary: await priorSummary(place, memory),
          readText: chapterDigest(rows, CONTEXT_BUDGET.chapterTalkFull),
          minSpots: range.min,
          maxSpots: range.max,
          stationLens: stationLensOf(book.station),
        },
        client,
        signal,
      )
      if (signal.aborted) return
      const sorted = [...rows].sort((a, b) => a.order - b.order)
      const spots: DeepSpotRow[] = result.spots.flatMap((spot) => {
        const start = rowAt(sorted, spot.start_pid)
        const end = rowAt(sorted, spot.end_pid)
        if (!end) return []
        return [
          {
            id: createId(),
            bookId: book.id,
            chapterId: place.chapterId,
            startParagraphId: start?.id ?? end.id,
            endParagraphId: end.id,
            startOrder: start?.order ?? end.order,
            endOrder: end.order,
            label: spot.label,
            why: spot.why,
            lens: spot.lens,
            status: 'planned',
            createdAt: new Date().toISOString(),
          },
        ]
      })
      await saveDeepSpots(spots)
      await log(book.id, 'deep', true, result.usage, undefined, Date.now() - started, { model: settings.model })
      enqueueDeepWork(rows, place, lastOrder)
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      await log(place.bookId, 'deep', false, EMPTY_USAGE, errorText(err, '深读规划失败'), Date.now() - started)
    }
  }

  async function generateDeep(
    spotId: string,
    place: Place,
    signal: AbortSignal,
    sceneEnd?: ParagraphRow,
  ): Promise<string | undefined> {
    const started = Date.now()
    const settings = useSettingsStore()
    try {
      const book = await getBook(place.bookId)
      const spots = await listDeepSpots(place.chapterId)
      const spot = spots.find((item) => item.id === spotId)
      const rows = await listParagraphs(place.chapterId)
      const end = sceneEnd ?? rows.find((row) => row.id === spot?.endParagraphId)
      if (!book || !end) return '这一段没有正文'
      if (spot?.status === 'done' && !sceneEnd) return
      const startOrder = spot?.startOrder ?? Math.max(1, end.order - 20)
      const sceneRows = tailWithin(
        rows.filter((row) => row.order >= startOrder && row.order <= end.order),
        CONTEXT_BUDGET.deepScene,
      )
      const block = textBlockOf(sceneRows)
      const memory = await readMemory(book.id)
      const prior = await priorSummary(place, memory)
      const snapshot = snapshotForPrompt(memory.memory)
      const later = laterNames(
        memory.entities,
        rows.filter((row) => row.order <= end.order).map((row) => row.text).join(''),
        rows.filter((row) => row.order > end.order).map((row) => row.text).join(''),
        prior + snapshot,
      )
      const names = memory.entities.filter((name) => sceneRows.some((row) => row.text.includes(name))).slice(0, 3)
      const passages = await passageCorpus(place, end.order)
      const earlier = names
        .flatMap((name) => passages.filter((passage) => passage.text.includes(name)).slice(0, 1))
        .slice(0, 3)
        .map((passage) => (passage.chapterTitle ? `《${passage.chapterTitle}》${passage.text}` : passage.text))
        .join('\n')
      const lineup = lineupFor(book.spoilerLevel, book.lineup)
      const client = settings.createClient()
      const generated = await runDeep(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: snapshot,
          priorSummary: prior,
          sceneText: formatBlock(block),
          earlierPassages: earlier,
          stationLens: stationLensOf(book.station),
          label: spot?.label || '这一段',
          why: spot?.why || '读者要求深入聊聊',
          lens: spot?.lens || '',
          lineupText: fullLineup(lineup),
        },
        block,
        client,
        new Set(memory.entities.filter((name) => !later.includes(name))),
        later,
        signal,
      )
      if (signal.aborted) return
      if (!generated.result) {
        if (spot) await updateDeepSpot(spot.id, { status: 'failed' })
        await log(book.id, 'deep', false, generated.usage, '长评未通过校验', Date.now() - started, {
          dropped: generated.dropped,
        })
        return dropNotice(generated.dropped, '长评没写出来')
      }
      const data = generated.result
      const thesisAuthor = lineup.find((persona) => persona.role === data.thesis.author) ?? lineup.find((persona) => persona.role === '课代表') ?? lineup[0]
      const rebuttalAuthor =
        lineup.find((persona) => persona.role === data.rebuttal?.author && persona.role !== thesisAuthor?.role) ??
        lineup.find((persona) => persona.role === '毒舌') ??
        lineup.find((persona) => persona.role !== thesisAuthor?.role)
      const threads = [
        {
          authorType: 'resident' as const,
          displayName: thesisAuthor?.displayName || data.thesis.author || '课代表',
          role: thesisAuthor?.role || '课代表',
          text: data.thesis.body,
          kind: 'deep' as const,
          title: data.thesis.title,
          evidence: data.thesis.evidence,
          background: data.background || undefined,
          question: data.question || undefined,
          replies: data.rebuttal?.body
            ? [
                {
                  authorType: 'resident' as const,
                  displayName: rebuttalAuthor?.displayName || data.rebuttal.author || '毒舌',
                  role: rebuttalAuthor?.role || '毒舌',
                  text: data.rebuttal.body,
                  replyType: '反驳',
                },
              ]
            : [],
        },
      ]
      const checked = await withoutSpoilers(
        book.id,
        book.spoilerLevel,
        prior,
        formatBlock(block),
        [{ root: { author_type: 'resident', text: threads[0]!.text, uses_outside_plot: false }, replies: threads[0]!.replies.map((reply) => ({ author_type: 'resident' as const, text: reply.text, uses_outside_plot: false })) }],
        client,
        signal,
      )
      if (signal.aborted) return
      if (!checked || checked.length === 0) {
        generated.dropped.spoiler += 1
        if (spot) await updateDeepSpot(spot.id, { status: 'failed' })
        await log(book.id, 'deep', false, generated.usage, '长评未过剧透校验', Date.now() - started, {
          dropped: generated.dropped,
        })
        return '没能通过剧透校验'
      }
      const verdict = checked[0]!
      await replacePinned(end.id, 'deep', [
        {
          ...threads[0]!,
          ...(verdict.root.folded ? { folded: true } : {}),
          replies: threads[0]!.replies.map((reply, index) => ({
            ...reply,
            ...(verdict.replies[index]?.folded ? { folded: true } : {}),
          })),
        },
      ])
      if (spot) await updateDeepSpot(spot.id, { status: 'done' })
      await log(book.id, 'deep', true, generated.usage, undefined, Date.now() - started, {
        dropped: generated.dropped,
      })
      if (place.chapterId === currentChapterId) await refresh(place.chapterId)
      return '长评写好了'
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      const message = errorText(err, '深读长评失败')
      await log(place.bookId, 'deep', false, EMPTY_USAGE, message, Date.now() - started)
      return message
    }
  }

  async function requestDeep(paragraphId: string) {
    notice.value = ''
    const place = here()
    if (needsKey.value) {
      notice.value = '先去设置里填写 API Key'
      return
    }
    const book = await getBook(place.bookId)
    if (!book || deepSpotRange(book).max <= 0) {
      notice.value = '这本书没有打开长评'
      return
    }
    const rows = await listParagraphs(place.chapterId)
    const row = rows.find((item) => item.id === paragraphId)
    if (!row) return
    const scene = tailWithin(
      rows.filter((item) => item.order <= row.order),
      CONTEXT_BUDGET.deepScene,
    )
    const start = scene[0] ?? row
    const spot: DeepSpotRow = {
      id: createId(),
      bookId: place.bookId,
      chapterId: place.chapterId,
      startParagraphId: start.id,
      endParagraphId: row.id,
      startOrder: start.order,
      endOrder: row.order,
      label: '深入聊聊',
      why: '读者要求深入聊聊',
      lens: '',
      status: 'planned',
      createdAt: new Date().toISOString(),
    }
    await saveDeepSpots([spot])
    const controller = new AbortController()
    sideCalls.add(controller)
    try {
      notice.value = (await generateDeep(spot.id, place, controller.signal, row)) || ''
    } finally {
      sideCalls.delete(controller)
    }
  }

  async function fetchBackground(paragraphId: string) {
    notice.value = ''
    const place = here()
    if (needsKey.value) {
      notice.value = '先去设置里填写 API Key'
      return
    }
    const controller = new AbortController()
    sideCalls.add(controller)
    const started = Date.now()
    try {
      const book = await getBook(place.bookId)
      const rows = await listParagraphs(place.chapterId)
      const row = rows.find((item) => item.id === paragraphId)
      if (!book || !row) return
      const upTo = rows.filter((item) => item.order <= row.order)
      const block = textBlockOf(tailWithin(upTo, CONTEXT_BUDGET.replyBefore))
      const memory = await readMemory(book.id)
      const prior = await priorSummary(place, memory)
      const later = laterNames(
        memory.entities,
        upTo.map((item) => item.text).join(''),
        rows.filter((item) => item.order > row.order).map((item) => item.text).join(''),
        prior,
      )
      const client = useSettingsStore().createClient()
      const generated = await runBackground(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          priorSummary: prior,
          textUntilHere: formatBlock(block),
          pid: `p${block.paragraphs.length}`,
        },
        block,
        client,
        new Set(memory.entities.filter((name) => !later.includes(name))),
        later,
        controller.signal,
      )
      if (controller.signal.aborted) return
      if (!generated.result) {
        notice.value = dropNotice(generated.dropped, '没查到背景')
        await log(book.id, 'background', false, generated.usage, '背景未通过校验', Date.now() - started, {
          dropped: generated.dropped,
        })
        return
      }
      const marks = await spoilerMarks(
        book.id,
        book.spoilerLevel,
        prior,
        formatBlock(block),
        [generated.result.text],
        client,
        controller.signal,
      )
      if (controller.signal.aborted) return
      if (marks.blocked) {
        generated.dropped.spoiler += 1
        notice.value = '没能通过剧透校验'
        await log(book.id, 'background', false, generated.usage, '背景未过剧透校验', Date.now() - started, {
          dropped: generated.dropped,
        })
        return
      }
      await replacePinned(row.id, 'background', [
        {
          authorType: 'resident',
          displayName: '考据',
          role: '考据癖',
          text: generated.result.text,
          kind: 'background',
          ...(marks.folded.has(0) ? { folded: true } : {}),
        },
      ])
      await log(book.id, 'background', true, generated.usage, undefined, Date.now() - started, {
        dropped: generated.dropped,
      })
      await refresh(place.chapterId)
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) return
      notice.value = errorText(err, '查背景失败')
      await log(place.bookId, 'background', false, EMPTY_USAGE, errorText(err, '查背景失败'), Date.now() - started)
    } finally {
      sideCalls.delete(controller)
    }
  }

  async function markInteresting(paragraphId: string) {
    if (!allowShort) return
    notice.value = ''
    const place = here()
    const rows = await listParagraphs(place.chapterId)
    const row = rows.find((item) => item.id === paragraphId)
    if (!row || row.kind === 'heading' || needsKey.value) return
    if (row.userMarked !== 'interesting') {
      const marked = rows.filter((item) => item.userMarked === 'interesting').length
      if (marked >= INTEREST_LIMIT_PER_CHAPTER) {
        notice.value = `这一章已经标了 ${INTEREST_LIMIT_PER_CHAPTER} 段`
        return
      }
    }
    await markUserInterest(paragraphId)
    if (row.genStatus !== 'none') await markParagraph(paragraphId, 'refining')
    await refresh(place.chapterId)
    enqueueRefine(row, place, '读者标记为有意思')
  }

  async function reroll(paragraphId: string) {
    rerollMessage.value = ''
    if (!allowShort) return
    if (needsKey.value || !currentBookId) {
      rerollMessage.value = '先去设置里填写 API Key'
      return
    }
    const place = here()
    const batches = await listBatches(paragraphId)
    if (!canReroll(batches, new Date())) {
      rerollMessage.value = '这一段今天已经换过 3 次'
      return
    }
    const latest = latestBatch(batches)
    const rows = await listParagraphs(place.chapterId)
    const paragraph = rows.find((item) => item.id === paragraphId)
    const book = await getBook(place.bookId)
    if (!paragraph || !book) {
      rerollMessage.value = '这一段没有正文'
      return
    }
    const carried = latest ? rowsToCarry(await commentsInBatch(latest.id)) : []
    const controller = new AbortController()
    sideCalls.add(controller)
    const started = Date.now()
    try {
      const client = useSettingsStore().createClient()
      const profiles = samplePassersby(`${paragraph.anchor}:${batches.length}`, 3)
      const result = await runPasserbyBatch(
        {
          text: paragraph.text,
          kept: carried
            .filter((row) => !row.parentId)
            .map((row) => `${row.displayName}：${row.text}`)
            .join('\n'),
          names: profiles.map((person) => person.displayName).join('、'),
        },
        client,
        controller.signal,
      )
      if (controller.signal.aborted) return
      const memory = await readMemory(book.id)
      const prior = await priorSummary(place, memory)
      const upTo = rows.filter((item) => item.order <= paragraph.order)
      const block = textBlockOf(tailWithin(upTo, CONTEXT_BUDGET.replyBefore))
      const later = laterNames(
        memory.entities,
        upTo.map((item) => item.text).join(''),
        rows.filter((item) => item.order > paragraph.order).map((item) => item.text).join(''),
        prior,
      )
      const index = block.paragraphs.length
      const allowed = new Set(
        filterByEntityRule(
          result.comments.map((comment) => ({ paragraphIndex: index, text: comment.text })),
          block,
          new Set(memory.entities.filter((name) => !later.includes(name))),
          later,
        ).map((comment) => comment.text),
      )
      const existing = carried.map((row) => row.text)
      const candidates = result.comments.filter(
        (comment) => allowed.has(comment.text) && !isNearDuplicate(comment.text, existing),
      )
      const marks = await spoilerMarks(
        book.id,
        book.spoilerLevel,
        prior,
        formatBlock(block),
        candidates.map((comment) => comment.text),
        client,
        controller.signal,
      )
      if (controller.signal.aborted) return
      if (marks.blocked || candidates.length === 0) {
        const namedLater = result.comments.some((comment) => !allowed.has(comment.text))
        rerollMessage.value = namedLater
          ? '提到了还没读到的名字'
          : marks.blocked
            ? '没能通过剧透校验'
            : '没换成新的一批'
        await log(book.id, 'live', false, result.usage, '换一批全被拦下', Date.now() - started)
        return
      }
      const fresh = candidates
      let seq = carried.reduce((max, row) => Math.max(max, row.seq ?? 0), -1) + 1
      const passers = fresh.map((comment, index) => ({
        id: createId(),
        batchId: '',
        paragraphId,
        parentId: '',
        authorType: 'passerby' as const,
        displayName: profiles[index]?.displayName || comment.display_name || '路人',
        role: '',
        text: comment.text,
        seq: seq++,
        ...(marks.folded.has(index) ? { folded: true } : {}),
      }))
      await saveNextBatch(paragraphId, nextBatchNo(batches), [...carried, ...passers])
      await log(book.id, 'live', true, result.usage, undefined, Date.now() - started)
      await refresh(place.chapterId)
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) return
      rerollMessage.value = errorText(err, '换一批失败')
      await log(book.id, 'live', false, EMPTY_USAGE, errorText(err, '换一批失败'), Date.now() - started)
    } finally {
      sideCalls.delete(controller)
    }
  }

  /** 保存微评并请两位书友回应。微评一定会存下；回应失败时返回 false。 */
  async function submitMicro(input: { judgment: string; evidence: string; reservation: string }): Promise<boolean> {
    if (!currentBookId || !currentChapterId) return false
    const place = here()
    await saveMicroReview({ bookId: place.bookId, chapterId: place.chapterId, ...input })
    const book = await getBook(place.bookId)
    if (!book || needsKey.value) {
      await loadTalk(place.chapterId)
      return true
    }
    const controller = new AbortController()
    sideCalls.add(controller)
    replying.value = true
    const started = Date.now()
    try {
      const lineup = lineupFor(book.spoilerLevel, book.lineup)
      const repliers = pickRepliers({ lineup, spoken: [] }).filter((person) => person.authorType === 'resident')
      const extra = lineup.find((persona) => !repliers.some((person) => person.role === persona.role))
      if (repliers.length < 2 && extra) {
        repliers.push({
          authorType: 'resident',
          role: extra.role,
          displayName: extra.displayName,
          voice: extra.voice,
        })
      }
      const rows = await listParagraphs(place.chapterId)
      const body = rows.filter((row) => row.kind !== 'heading')
      const block = textBlockOf(tailWithin(body.length > 0 ? body : rows, CONTEXT_BUDGET.replyBefore))
      const memory = await readMemory(book.id)
      const replies: ChapterTalkRow['replies'] = []
      const client = useSettingsStore().createClient()
      const result = await runLiveReply(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: snapshotForPrompt(memory.memory),
          priorSummary: await priorSummary(place, memory),
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
        new Set(memory.entities),
        (reply) => {
          replies.push({ role: reply.reader_role || reply.display_name || '书友', text: reply.text })
        },
        controller.signal,
      )
      if (controller.signal.aborted) return true
      await storeTalkReplies(book, place.chapterId, replies)
      await log(book.id, 'live', replies.length > 0, result.usage, undefined, Date.now() - started)
      return replies.length > 0
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) return true
      await log(book.id, 'live', false, EMPTY_USAGE, errorText(err, '微评回应失败'), Date.now() - started)
      return false
    } finally {
      sideCalls.delete(controller)
      replying.value = false
      await loadTalk(place.chapterId)
    }
  }

  async function storeTalkReplies(book: BookRow, chapterId: string, replies: ChapterTalkRow['replies']) {
    const existing = await readChapterTalk(chapterId)
    if (!existing) {
      await saveChapterTalk({
        id: createId(),
        bookId: book.id,
        chapterId,
        paragraphId: '',
        hotParagraphIds: [],
        residentLines: [],
        debates: [],
        predictionUpdates: [],
        replies,
        createdAt: new Date().toISOString(),
      })
    } else {
      await addTalkReplies(chapterId, replies)
    }
  }

  return {
    needsKey,
    pendingIds,
    replying,
    replyFailed,
    chapterTalk,
    rerollMessage,
    notice,
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
    requestDeep,
    fetchBackground,
    submitMicro,
  }
})
