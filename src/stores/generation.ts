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
import { briefLineup, fullLineup, pickRepliers } from '@/core/personas'
import { canReroll, latestBatch, nextBatchNo, rowsToCarry } from '@/core/comments/batches'
import {
  commentPasses,
  filterByEntityRule,
  formatBlock,
  runChapterTalk,
  runLiveReply,
  runPasserbyBatch,
  runRefine,
  runRoughStream,
  runSpoilerCheck,
} from '@/core/generation'
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
  assignOne,
  blockIndex,
  BUFFER_LOW,
  BUFFER_TARGET,
  COLD_BLOCK_PARAS,
  HOT_LIMIT,
  jumpBlock,
  lineupFor,
  planNextBlock,
  readyAhead,
  toTextBlock,
  type AssignedParagraph,
} from '@/core/generation/pipeline'
import { pidToIndex, type RefineComment, type RoughParagraph } from '@/core/generation/schema'
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
  updateMemory,
  writeGenerationLog,
  type MemoryState,
} from '@/db/repos/comments'
import { getBook, listChapters, listParagraphs, saveChapterSummary } from '@/db/repos/library'
import { addTalkReplies, readChapterTalk, saveChapterTalk, saveMicroReview } from '@/db/repos/notes'
import { createId } from '@/db/id'
import type { BookRow, ChapterRow, ChapterTalkRow, ParagraphRow } from '@/db/schema'
import { useSettingsStore } from '@/stores/settings'
import { useCommentsStore } from '@/stores/comments'

/** 每章最多手动标几段"有意思" */
export const INTEREST_LIMIT_PER_CHAPTER = 5

type LogType = 'rough' | 'refine' | 'live' | 'chapterTalk' | 'spoilerCheck'

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

function findComment(threads: ReaderThread[], id: string) {
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

  function here(): Place {
    return { bookId: currentBookId, chapterId: currentChapterId }
  }

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
  }

  function ensure(rows: ParagraphRow[], order: number, place: Place) {
    if (needsKey.value || place.chapterId !== currentChapterId) return
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
    for (const row of rows) {
      if (row.genStatus !== 'refining') continue
      enqueueRefine(row, place, row.userMarked === 'interesting' ? '读者标记为有意思' : '粗评分为 3')
    }
  }

  async function retry(paragraphId: string) {
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

  async function runBlock(rows: ParagraphRow[], kind: 'rough' | 'live', place: Place, signal: AbortSignal) {
    const started = Date.now()
    const saved = new Set<string>()
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

      const assigned = new Map<string, AssignedParagraph<ParagraphRow>>()
      let hot = 0
      let chain = Promise.resolve()
      const accept = (paragraph: RoughParagraph) => {
        const row = rowAt(rows, paragraph.pid)
        if (!row || assigned.has(row.id)) return
        const result = assignOne(row, paragraph, hot)
        if (result.hot) hot += 1
        assigned.set(row.id, result)
        chain = chain.then(async () => {
          if (signal.aborted) return
          await saveParagraphComments(row.id, result.comments, result.score, result.genStatus)
          saved.add(row.id)
          inflight.delete(row.id)
          touchPending()
          if (result.hot) enqueueRefine(row, place, result.reason)
          scheduleRefresh(place.chapterId)
        })
      }

      const result = await runRoughStream(
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
        },
        block,
        client,
        new Set(memory.entities),
        accept,
        signal,
      )
      await chain
      if (signal.aborted) return

      // 流式时每段只按当时已知的新实体过滤过。收齐后按完整实体表再看一遍，多删的才重写。
      const statusNow = new Map((await listParagraphs(place.chapterId)).map((row) => [row.id, row.genStatus]))
      for (const paragraph of result.paragraphs) {
        const row = rowAt(rows, paragraph.pid)
        const earlier = row ? assigned.get(row.id) : undefined
        if (!row || !earlier || paragraph.comments.length >= earlier.comments.length) continue
        if (statusNow.get(row.id) === 'refined') continue
        const fixed = assignOne(row, paragraph, earlier.hot ? 0 : HOT_LIMIT)
        await saveParagraphComments(row.id, fixed.comments, earlier.score, earlier.genStatus)
      }
      for (const row of rows) {
        if (!saved.has(row.id)) await saveParagraphComments(row.id, [], 0, 'rough')
      }

      const hits = result.paragraphs.flatMap((item) => item.prediction_hits)
      await updateMemory(book.id, (state) => ({
        ...state,
        memory: { ...state.memory, predictions: resolvePredictions(state.memory.predictions, hits) },
        entities: unionEntities(state.entities, result.new_entities),
      }))
      await log(book.id, kind, true, result.usage, undefined, Date.now() - started)
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
        },
        block,
        client,
        new Set(memory.entities.filter((name) => !later.includes(name))),
        later,
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
        // 校验没过或全被拦下：保留粗评那条占位，不清空这一段。
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
      await log(book.id, 'refine', true, result.usage, undefined, Date.now() - started)
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      await markParagraph(paragraphId, 'failed')
      await log(place.bookId, 'refine', false, EMPTY_USAGE, errorText(err, '精修失败'), Date.now() - started)
    } finally {
      if (!signal.aborted) await refresh(place.chapterId)
    }
  }

  /**
   * 二次剧透校验。返回 null 表示严格档位下校验本身失败，调用方应当不采用这批结果。
   * 严格档位下，校验结果里漏掉的评论也按不通过处理。
   */
  async function withoutSpoilers<T extends { root: RefineComment; replies: RefineComment[] }>(
    bookId: string,
    spoilerLevel: string,
    prior: string,
    text: string,
    threads: T[],
    client: LlmClient,
    signal: AbortSignal,
  ): Promise<T[] | null> {
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
      return tagged
        .filter((item) => commentPasses(item.rootId, checked.results, strict))
        .map((item) => ({
          ...item.thread,
          replies: item.thread.replies.filter((_, replyIndex) =>
            commentPasses(item.replyIds[replyIndex] ?? '', checked.results, strict),
          ),
        }))
    } catch (err) {
      if (isAbort(err) || signal.aborted) return null
      await log(bookId, 'spoilerCheck', false, EMPTY_USAGE, errorText(err, '校验失败'), Date.now() - started)
      return strict ? null : threads
    }
  }

  /** 单条评论的剧透校验（换一批、本章说），返回通过的下标。 */
  async function passingIndexes(
    bookId: string,
    spoilerLevel: string,
    prior: string,
    text: string,
    lines: string[],
    client: LlmClient,
    signal: AbortSignal,
  ): Promise<Set<number>> {
    const all = new Set(lines.map((_, index) => index))
    if (spoilerLevel !== '严格' || lines.length === 0) return all
    const threads = lines.map((line) => ({
      root: { author_type: 'resident' as const, text: line, uses_outside_plot: false },
      replies: [] as RefineComment[],
      index: 0,
    }))
    threads.forEach((thread, index) => (thread.index = index))
    const kept = await withoutSpoilers(bookId, spoilerLevel, prior, text, threads, client, signal)
    return new Set((kept ?? []).map((thread) => thread.index))
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
      let chain = Promise.resolve()
      const result = await runLiveReply(
        {
          title: book.title,
          spoilerLevel: book.spoilerLevel,
          memorySnapshot: snapshot,
          priorSummary: prior,
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
        new Set(memory.entities.filter((name) => !later.includes(name))),
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
      const passing = await passingIndexes(
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
        residentLines: lines
          .filter((_, index) => passing.has(index))
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
  ) {
    await writeGenerationLog({
      bookId,
      type,
      ok,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cacheHitTokens: usage.cacheHitTokens,
      reasoningTokens: usage.reasoningTokens,
      cost: estimateCost(usage, useSettingsStore().pricing),
      error,
      latencyMs,
    })
  }

  async function loadTalk(chapterId: string) {
    chapterTalk.value = (await readChapterTalk(chapterId)) ?? null
  }

  async function markInteresting(paragraphId: string) {
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
    if (needsKey.value || !currentBookId) return
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
    if (!latest || !paragraph || !book) return
    const carried = rowsToCarry(await commentsInBatch(latest.id))
    const controller = new AbortController()
    sideCalls.add(controller)
    const started = Date.now()
    try {
      const client = useSettingsStore().createClient()
      const result = await runPasserbyBatch(
        {
          text: paragraph.text,
          kept: carried
            .filter((row) => !row.parentId)
            .map((row) => `${row.displayName}：${row.text}`)
            .join('\n'),
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
      const candidates = result.comments.filter((comment) => allowed.has(comment.text))
      const passing = await passingIndexes(
        book.id,
        book.spoilerLevel,
        prior,
        formatBlock(block),
        candidates.map((comment) => comment.text),
        client,
        controller.signal,
      )
      if (controller.signal.aborted) return
      const fresh = candidates.filter((_, index) => passing.has(index))
      if (fresh.length === 0) {
        rerollMessage.value = '没换成新的一批'
        await log(book.id, 'live', false, result.usage, '换一批全被拦下', Date.now() - started)
        return
      }
      let seq = carried.reduce((max, row) => Math.max(max, row.seq ?? 0), -1) + 1
      const passers = fresh.map((comment) => ({
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
      await saveNextBatch(paragraphId, nextBatchNo(batches), [...carried, ...passers])
      await log(book.id, 'live', true, result.usage, undefined, Date.now() - started)
      await refresh(place.chapterId)
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) return
      rerollMessage.value = '没换成新的一批'
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
          voice: extra.voiceSamples[0] ?? '',
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
    submitMicro,
  }
})
