<template>
  <div class="reader">
    <VanNavBar :title="book?.title || '阅读'" left-arrow @click-left="goLibrary">
      <template #right>
        <button class="reader__tool" type="button" @click="tocOpen = true">目录</button>
        <button class="reader__tool" type="button" @click="goArchive">档案</button>
        <button class="reader__tool" type="button" @click="displayOpen = !displayOpen">Aa</button>
      </template>
    </VanNavBar>

    <div v-if="displayOpen" class="reader__display">
      <label>
        字号 {{ settings.display.fontSize }}
        <input
          type="range"
          min="16"
          max="24"
          step="1"
          :value="settings.display.fontSize"
          @input="onFont"
        />
      </label>
      <label>
        行距 {{ settings.display.lineHeight }}
        <input
          type="range"
          min="1.6"
          max="2.2"
          step="0.1"
          :value="settings.display.lineHeight"
          @input="onLine"
        />
      </label>
      <div class="reader__themes">
        <button type="button" @click="onTheme('day')">日间</button>
        <button type="button" @click="onTheme('eye')">护眼</button>
        <button type="button" @click="onTheme('night')">夜间</button>
      </div>
      <label class="reader__toggle">
        <input type="checkbox" :checked="settings.display.danmaku" @change="onDanmaku" />
        热段弹幕
      </label>
      <button type="button" @click="notesOpen = true">批注 {{ chapterNotes.length }}</button>
    </div>

    <p v-if="generation.needsKey" class="reader__key">
      还没有 API Key，书友先不说话。
      <button type="button" @click="goSettings">去设置</button>
    </p>

    <p v-if="error" class="reader__hint">{{ error }}</p>

    <div v-else class="reader__body">
      <div ref="scrollEl" class="reader__scroll" @scroll="onScroll">
        <ChapterContent
          :title="chapterTitle"
          :comments-hidden="comments.chapterLocked"
          :paragraphs="shown"
          :bubbles="comments.bubbles"
          @open="openComments"
          @interesting="onInteresting"
          @highlight="onHighlight"
          @link="onLink"
        />
        <ChapterTalk
          :hidden="comments.chapterLocked"
          :replying="generation.replying"
          :talk="generation.chapterTalk"
          :micro="micro"
          :default-open="book?.microReviewOpen !== false"
          :openings="openings"
          @jump="jumpTo"
          @submit="onMicro"
        />
        <div class="reader__pager">
          <button type="button" :disabled="!prevChapter" @click="goChapter(prevChapter?.id)">上一章</button>
          <button type="button" :disabled="!nextChapter" @click="goChapter(nextChapter?.id)">下一章</button>
        </div>
      </div>
      <aside class="reader__rail">
        <CommentPanel
          v-if="wide && panelOpen"
          :threads="comments.threads"
          :pending="panelPending"
          :failed="panelFailed"
          :replying="generation.replying"
          :reply-failed="generation.replyFailed"
          :residents="residents"
          :reply-to="replyTo"
          :locked="panelLocked"
          :batch-no="comments.batchNo"
          :batch-count="comments.batchCount"
          :rerolls-left="comments.rerollsLeft"
          :reroll-message="generation.rerollMessage"
          @retry="onRetry(comments.activeId)"
          @retry-reply="generation.retryReply()"
          @reply="startReply"
          @cancel-reply="replyTo = null"
          @mark="onMark"
          @submit="onSubmit"
          @reroll="onReroll"
          @batch="onBatch"
          @close="closeComments"
        />
        <template v-else>
          <strong>评论</strong>
          <p>读到后面，书友会写在这里。</p>
        </template>
      </aside>
    </div>

    <VanPopup
      v-if="!wide"
      v-model:show="panelOpen"
      position="bottom"
      :lock-scroll="false"
      class="reader__sheet"
      @open="holdScroll"
      @opened="holdScroll"
      @close="holdScroll"
      @closed="onSheetClosed"
    >
      <CommentPanel
        :threads="comments.threads"
        :pending="panelPending"
        :failed="panelFailed"
        :replying="generation.replying"
        :reply-failed="generation.replyFailed"
        :residents="residents"
        :reply-to="replyTo"
        :locked="panelLocked"
        :batch-no="comments.batchNo"
        :batch-count="comments.batchCount"
        :rerolls-left="comments.rerollsLeft"
        :reroll-message="generation.rerollMessage"
        @retry="onRetry(comments.activeId)"
        @retry-reply="generation.retryReply()"
        @reply="startReply"
        @cancel-reply="replyTo = null"
        @mark="onMark"
        @submit="onSubmit"
        @reroll="onReroll"
        @batch="onBatch"
        @close="closeComments"
      />
    </VanPopup>

    <button v-if="danmaku" class="reader__danmaku" type="button" @click="openDanmaku">
      {{ danmaku.text }}
    </button>

    <VanPopup v-model:show="notesOpen" position="bottom" :lock-scroll="false" class="reader__sheet">
      <section class="reader__notes">
        <h2>这一章的批注</h2>
        <p v-if="chapterNotes.length === 0">还没有划线。</p>
        <p v-for="note in chapterNotes" :key="note.id">「{{ note.quote }}」 {{ note.text }}</p>
      </section>
    </VanPopup>

    <VanPopup v-model:show="highlightOpen" position="bottom" :lock-scroll="false" class="reader__sheet">
      <form class="reader__notes" @submit.prevent="saveHighlightNote">
        <h2>划线批注</h2>
        <p v-if="highlightDraft">「{{ highlightDraft.quote }}」</p>
        <textarea v-model="noteText" rows="3" placeholder="写一句批注" />
        <button type="submit" :disabled="!noteText.trim()">保存</button>
      </form>
    </VanPopup>

    <VanPopup v-model:show="footnoteOpen" position="bottom" :lock-scroll="false" class="reader__sheet">
      <section v-if="footnote" class="reader__notes">
        <h2>注释</h2>
        <p>{{ footnote.text }}</p>
        <button v-if="footnote.here" type="button" @click="jumpToFootnote">跳到这一段</button>
      </section>
    </VanPopup>

    <VanPopup v-model:show="tocOpen" position="left" :lock-scroll="false" class="reader__toc">
      <ul>
        <li v-for="chapter in chapters" :key="chapter.id">
          <button type="button" @click="goChapter(chapter.id)">{{ chapter.title }}</button>
        </li>
      </ul>
    </VanPopup>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NavBar as VanNavBar, Popup as VanPopup, showToast } from 'vant'
import { findLinkTarget, imageSrcs, loadChapterImages, resolveBookLink, rewriteImages } from '@/core/epub'
import { paragraphOpening } from '@/core/export/markdown'
import { lineupFor } from '@/core/generation/pipeline'
import ChapterContent from '@/components/reader/ChapterContent.vue'
import ChapterTalk from '@/components/reader/ChapterTalk.vue'
import CommentPanel from '@/components/reader/CommentPanel.vue'
import { shortReaction } from '@/db/repos/comments'
import {
  getBook,
  getReadingState,
  listChapters,
  listParagraphs,
  recordProgress,
  type ProgressInput,
} from '@/db/repos/library'
import { listNotes, saveHighlight } from '@/db/repos/notes'
import type { BookRow, ChapterRow, ParagraphRow, ReadingStateRow, UserNoteRow } from '@/db/schema'
import { platform } from '@/platform'
import { useCommentsStore } from '@/stores/comments'
import { useGenerationStore } from '@/stores/generation'
import { useSettingsStore, type ReaderTheme } from '@/stores/settings'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const generation = useGenerationStore()
const comments = useCommentsStore()
const scrollEl = ref<HTMLElement | null>(null)
const book = ref<BookRow | null>(null)
const chapters = ref<ChapterRow[]>([])
const shown = ref<ParagraphRow[]>([])
const error = ref('')
const tocOpen = ref(false)
const displayOpen = ref(false)
const panelOpen = ref(false)
const notesOpen = ref(false)
const replyTo = ref<{ id: string; name: string } | null>(null)
const wide = ref(false)
const chapterNotes = ref<UserNoteRow[]>([])
const micro = ref<{ judgment: string; evidence: string; reservation: string } | null>(null)
const highlightDraft = ref<{ paragraphId: string; quote: string; start: number; end: number } | null>(null)
const noteText = ref('')
const danmaku = ref<{ paragraphId: string; text: string } | null>(null)
const footnote = ref<{ paragraphId: string; text: string; here: boolean } | null>(null)
const footnoteOpen = computed({
  get: () => footnote.value !== null,
  set: (open: boolean) => {
    if (!open) footnote.value = null
  },
})
const highlightOpen = computed({
  get: () => highlightDraft.value !== null,
  set: (open: boolean) => {
    if (!open) highlightDraft.value = null
  },
})
const urls: string[] = []
let scrollSnapshot = 0
let media: MediaQueryList | null = null
let danmakuUntil = 0
let lastScrollTop = 0
let lastScrollAt = 0
let scrollingFast = false

function applyWide() {
  wide.value = media?.matches ?? false
}

let observer: IntersectionObserver | null = null
let loadToken = 0
let readFloor = 0
let ignore = false
let timer = 0
let pending: ProgressInput | null = null
/** 最后一段完整露出满这么久，就算读完这一章。 */
const LAST_VISIBLE_MS = 2000
let lastVisibleTimer = 0

const bookId = computed(() => String(route.params.bookId))
const chapterId = computed(() =>
  typeof route.params.chapterId === 'string' ? route.params.chapterId : '',
)
const chapterTitle = computed(
  () => chapters.value.find((chapter) => chapter.id === chapterId.value)?.title ?? '',
)
const chapterIndex = computed(() => chapters.value.findIndex((chapter) => chapter.id === chapterId.value))
const prevChapter = computed(() => chapters.value[chapterIndex.value - 1])
const nextChapter = computed(() => chapters.value[chapterIndex.value + 1])
const panelPending = computed(() => comments.bubbles[comments.activeId]?.pending ?? false)
const panelFailed = computed(() => comments.bubbles[comments.activeId]?.failed ?? false)
const panelLocked = computed(() => comments.bubbles[comments.activeId]?.locked === true)
const openings = computed(() => {
  const map: Record<string, string> = {}
  for (const paragraph of shown.value) map[paragraph.id] = paragraphOpening(paragraph.text)
  return map
})
const residents = computed(() =>
  lineupFor(book.value?.spoilerLevel ?? '严格', book.value?.lineup).map((persona) => persona.role),
)

onMounted(() => {
  generation.bind()
  media = window.matchMedia('(min-width: 960px)')
  applyWide()
  media.addEventListener('change', applyWide)
})

watch(
  () => route.fullPath,
  () => {
    void load()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  loadToken += 1
  window.clearTimeout(lastVisibleTimer)
  observer?.disconnect()
  revokeUrls()
  generation.stop()
  media?.removeEventListener('change', applyWide)
  void flush()
})

async function load() {
  const token = ++loadToken
  error.value = ''
  const id = bookId.value
  const found = await getBook(id)
  if (token !== loadToken) return
  if (!found) {
    error.value = '找不到这本书'
    return
  }
  book.value = found
  chapters.value = await listChapters(id)
  if (token !== loadToken || route.name !== 'reader') return
  const state = await getReadingState(id)
  const target = chapterId.value || state?.chapterId || chapters.value[0]?.id || ''
  if (!target) {
    error.value = '这本书没有章节'
    return
  }
  if (target !== chapterId.value) {
    await router.replace({ name: 'reader', params: { bookId: id, chapterId: target } })
    return
  }
  await showChapter(target, state)
}

async function showChapter(id: string, state: ReadingStateRow | undefined) {
  await flush()
  window.clearTimeout(lastVisibleTimer)
  lastVisibleTimer = 0
  observer?.disconnect()
  revokeUrls()
  const paragraphs = await listParagraphs(id)
  shown.value = paragraphs
  readFloor = state?.readUpTo[id] ?? 0
  const chapter = chapters.value.find((item) => item.id === id)
  try {
    const bytes = await platform.readBookFile(bookId.value)
    const srcs = paragraphs.flatMap((paragraph) => imageSrcs(paragraph.html))
    if (chapter && srcs.length > 0) {
      const images = await loadChapterImages(bytes, chapter.href, srcs)
      const map = new Map<string, string>()
      for (const image of images) {
        const url = URL.createObjectURL(new Blob([toArrayBuffer(image.bytes)], { type: image.mediaType }))
        urls.push(url)
        map.set(image.src, url)
      }
      shown.value = paragraphs.map((paragraph) => ({
        ...paragraph,
        html: rewriteImages(paragraph.html, map),
      }))
    }
  } catch {
    shown.value = paragraphs
  }
  ignore = true
  await nextTick()
  restore(state, id)
  bindObserver()
  requestAnimationFrame(() => {
    ignore = false
    queueSave()
  })
  const order = state?.chapterId === id ? state.paragraphIndex : 1
  comments.setGate({
    bookId: bookId.value,
    mode: book.value?.unlockMode ?? '关闭',
    chapterDone: chapter?.readStatus === 'done',
  })
  await reloadNotes()
  await generation.loadTalk(id)
  await generation.sync({ bookId: bookId.value, chapterId: id, order })
}

function restore(state: ReadingStateRow | undefined, id: string) {
  const root = scrollEl.value
  if (!root || !state || state.chapterId !== id) {
    if (root) root.scrollTop = 0
    return
  }
  const el = root.querySelector<HTMLElement>(`[data-order="${state.paragraphIndex}"]`)
  if (!el) return
  const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
  root.scrollTop = top + state.offsetRatio * el.offsetHeight
}

function bindObserver() {
  const root = scrollEl.value
  if (!root) return
  observer?.disconnect()
  observer = new IntersectionObserver(
    (entries) => {
      const top = root.getBoundingClientRect().top
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.order)
        if (!Number.isFinite(index)) continue
        if (entry.boundingClientRect.bottom <= top + 1) readFloor = Math.max(readFloor, index)
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) maybeDanmaku(entry.target as HTMLElement)
      }
      queueSave()
    },
    { root, threshold: [0, 1] },
  )
  for (const node of root.querySelectorAll('[data-order]')) observer.observe(node)
}

function onScroll() {
  const root = scrollEl.value
  const now = performance.now()
  const top = root?.scrollTop ?? 0
  const elapsed = now - lastScrollAt
  if (lastScrollAt > 0 && elapsed > 0) scrollingFast = Math.abs(top - lastScrollTop) / elapsed > 1.2
  lastScrollTop = top
  lastScrollAt = now
  queueSave()
}

function maybeDanmaku(node: HTMLElement) {
  if (!settings.display.danmaku || comments.chapterLocked) return
  if (danmaku.value || Date.now() < danmakuUntil || scrollingFast) return
  const id = node.closest('[data-paragraph-id]')?.getAttribute('data-paragraph-id') ?? ''
  if (!id || comments.bubbles[id]?.hot !== true) return
  void showDanmaku(id)
}

async function showDanmaku(id: string) {
  if (danmaku.value || Date.now() < danmakuUntil) return
  const reaction = await shortReaction(id)
  if (!reaction || danmaku.value || Date.now() < danmakuUntil) return
  danmaku.value = { paragraphId: id, text: reaction.text }
  danmakuUntil = Date.now() + 3000
  window.setTimeout(() => {
    if (danmaku.value?.paragraphId === id) danmaku.value = null
  }, 3000)
}

function openDanmaku() {
  const id = danmaku.value?.paragraphId
  if (id) void openComments(id)
}

function queueSave() {
  if (ignore || !chapterId.value) return
  const measured = measure()
  if (!measured) return
  pending = measured
  if (timer) return
  timer = window.setTimeout(() => {
    void flush()
  }, 2000)
}

function measure(): ProgressInput | null {
  const root = scrollEl.value
  if (!root) return null
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-order]')]
  if (nodes.length === 0) return null
  const top = root.getBoundingClientRect().top
  let paragraphIndex = Number(nodes[0]?.dataset.order ?? 1)
  let offsetRatio = 0
  let readUpTo = readFloor
  let placed = false
  for (const node of nodes) {
    const index = Number(node.dataset.order)
    const rect = node.getBoundingClientRect()
    if (rect.bottom <= top + 1) readUpTo = Math.max(readUpTo, index)
    if (!placed && rect.bottom > top) {
      paragraphIndex = index
      offsetRatio = rect.height > 0 ? Math.min(1, Math.max(0, (top - rect.top) / rect.height)) : 0
      placed = true
    }
  }
  const last = nodes[nodes.length - 1]
  const chapterLength = Number(last?.dataset.order ?? 0)
  const scrollable = root.scrollHeight > root.clientHeight + 4
  const atBottom = scrollable && root.scrollTop + root.clientHeight >= root.scrollHeight - 4
  if (atBottom) readUpTo = Math.max(readUpTo, chapterLength)
  else if (last && readUpTo < chapterLength) watchLast(root, last, chapterLength)
  readFloor = readUpTo
  return {
    chapterId: chapterId.value,
    paragraphIndex,
    offsetRatio,
    readUpTo,
    chapterLength,
  }
}

function lastFullyVisible(root: HTMLElement, last: HTMLElement): boolean {
  const view = root.getBoundingClientRect()
  const rect = last.getBoundingClientRect()
  return rect.bottom <= view.bottom && rect.bottom > view.top
}

function watchLast(root: HTMLElement, last: HTMLElement, chapterLength: number) {
  if (!lastFullyVisible(root, last)) {
    window.clearTimeout(lastVisibleTimer)
    lastVisibleTimer = 0
    return
  }
  if (lastVisibleTimer) return
  const chapter = chapterId.value
  lastVisibleTimer = window.setTimeout(() => {
    lastVisibleTimer = 0
    if (chapter !== chapterId.value || !last.isConnected || !lastFullyVisible(root, last)) return
    readFloor = Math.max(readFloor, chapterLength)
    queueSave()
  }, LAST_VISIBLE_MS)
}

async function flush() {
  if (timer) {
    window.clearTimeout(timer)
    timer = 0
  }
  if (!pending) return
  const payload = pending
  pending = null
  await recordProgress(bookId.value, payload)
  await generation.sync({
    bookId: bookId.value,
    chapterId: payload.chapterId,
    order: payload.paragraphIndex,
  })
  if (payload.chapterLength > 0 && payload.readUpTo >= payload.chapterLength) {
    const finished = chapters.value.find((item) => item.id === payload.chapterId)
    if (finished) finished.readStatus = 'done'
    comments.setGate({
      bookId: bookId.value,
      mode: book.value?.unlockMode ?? '关闭',
      chapterDone: true,
    })
    await generation.finishChapter(payload.chapterId)
    await comments.loadChapter(payload.chapterId, new Set(generation.pendingIds))
    await generation.loadTalk(payload.chapterId)
  }
}

function goChapter(id: string | undefined) {
  if (!id || id === chapterId.value) return
  tocOpen.value = false
  void router.replace({ name: 'reader', params: { bookId: bookId.value, chapterId: id } })
}

function goLibrary() {
  loadToken += 1
  tocOpen.value = false
  panelOpen.value = false
  displayOpen.value = false
  void router.replace({ name: 'library' })
}

function goSettings() {
  void router.push({ name: 'settings' })
}

function goArchive() {
  void router.push({ name: 'archive', params: { bookId: bookId.value } })
}

async function reloadNotes() {
  const rows = await listNotes(bookId.value)
  chapterNotes.value = rows.filter((note) => note.chapterId === chapterId.value && note.type === '划线批注')
  const row = rows.find((note) => note.chapterId === chapterId.value && note.type === '本章微评')
  micro.value = row
    ? {
        judgment: row.judgment ?? '',
        evidence: row.evidence ?? '',
        reservation: row.reservation ?? '',
      }
    : null
}

function holdScroll() {
  const top = scrollSnapshot
  const apply = () => {
    const root = scrollEl.value
    if (root) root.scrollTop = top
  }
  apply()
  void nextTick(apply)
  requestAnimationFrame(() => {
    apply()
    requestAnimationFrame(apply)
  })
}

async function openComments(id: string) {
  scrollSnapshot = scrollEl.value?.scrollTop ?? 0
  await comments.open(id)
  panelOpen.value = true
  holdScroll()
}

function closeComments() {
  scrollSnapshot = scrollEl.value?.scrollTop ?? 0
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  panelOpen.value = false
  if (wide.value) comments.close()
  holdScroll()
}

function onSheetClosed() {
  if (!panelOpen.value) comments.close()
  holdScroll()
}

function onRetry(id: string) {
  if (!id) return
  void generation.retry(id)
}

function startReply(id: string, name: string) {
  replyTo.value = { id, name }
}

function onSubmit(payload: { text: string; mention: string }) {
  if (!comments.activeId) return
  void generation.postComment({
    paragraphId: comments.activeId,
    text: payload.text,
    parentId: replyTo.value?.id,
    mention: payload.mention || undefined,
  })
  replyTo.value = null
}

function onMark(id: string, mark: 'saved' | 'boring' | 'spoiler' | 'wrong', on: boolean) {
  void comments.mark(id, mark, on)
}

async function onInteresting(id: string) {
  await generation.markInteresting(id)
  if (generation.notice) showToast(generation.notice)
}

function onHighlight(payload: { paragraphId: string; quote: string; start: number; end: number }) {
  highlightDraft.value = payload
  noteText.value = ''
}

async function saveHighlightNote() {
  const draft = highlightDraft.value
  const text = noteText.value.trim()
  if (!draft || !text) return
  await saveHighlight({
    bookId: bookId.value,
    chapterId: chapterId.value,
    paragraphId: draft.paragraphId,
    quote: draft.quote,
    text,
    start: draft.start,
    end: draft.end,
  })
  highlightDraft.value = null
  noteText.value = ''
  await reloadNotes()
  await comments.loadChapter(chapterId.value, new Set(generation.pendingIds))
}

async function onMicro(payload: { judgment: string; evidence: string; reservation: string }) {
  const answered = await generation.submitMicro(payload)
  if (!answered) showToast('微评已保存，书友暂时没接上话')
  await reloadNotes()
  const chapter = chapters.value.find((item) => item.id === chapterId.value)
  comments.setGate({
    bookId: bookId.value,
    mode: book.value?.unlockMode ?? '关闭',
    chapterDone: chapter?.readStatus === 'done',
  })
  await comments.loadChapter(chapterId.value, new Set(generation.pendingIds))
}

async function onReroll() {
  const id = comments.activeId
  if (!id) return
  await generation.reroll(id)
  await comments.open(id)
}

function onBatch(offset: number) {
  void comments.showBatch(offset)
}

function jumpTo(id: string) {
  scrollEl.value?.querySelector(`[data-paragraph-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
}

function onFont(event: Event) {
  const fontSize = Number((event.target as HTMLInputElement).value)
  void settings.saveDisplay({ ...settings.display, fontSize })
}

function onLine(event: Event) {
  const lineHeight = Number((event.target as HTMLInputElement).value)
  void settings.saveDisplay({ ...settings.display, lineHeight })
}

function onTheme(theme: ReaderTheme) {
  void settings.saveDisplay({ ...settings.display, theme })
}

function onDanmaku(event: Event) {
  const danmakuOn = (event.target as HTMLInputElement).checked
  void settings.saveDisplay({ ...settings.display, danmaku: danmakuOn })
}

async function onLink(href: string) {
  const chapter = chapters.value.find((item) => item.id === chapterId.value)
  const link = chapter ? resolveBookLink(chapter.href, href) : null
  if (!link) return
  if (link.kind === 'external') {
    showToast('外部链接不在阅读器里打开')
    return
  }
  const target = chapters.value.find((item) => item.href === link.path)
  if (!target) return
  const rows = target.id === chapterId.value ? shown.value : await listParagraphs(target.id)
  const found = findLinkTarget(rows, link.fragment)
  if (!found) return
  footnote.value = { paragraphId: found.id, text: found.text, here: target.id === chapterId.value }
}

function jumpToFootnote() {
  const id = footnote.value?.paragraphId
  footnote.value = null
  if (id) jumpTo(id)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

function revokeUrls() {
  for (const url of urls) URL.revokeObjectURL(url)
  urls.length = 0
}
</script>

<style scoped lang="less">
.reader {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--rs-bg);
  color: var(--rs-text);
}

.reader :deep(.van-nav-bar) {
  position: relative;
  z-index: 3000;
}

.reader__tool {
  border: 0;
  background: transparent;
  color: var(--rs-accent);
  font-size: 14px;
  margin-left: 12px;
}

.reader__display {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  padding: 8px 16px 12px;
  border-bottom: 1px solid var(--rs-border);
  background: var(--rs-surface);

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--rs-muted);
  }
}

.reader__toggle {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.reader__themes {
  display: flex;
  gap: 8px;
  align-items: flex-end;

  button {
    border: 1px solid var(--rs-border);
    background: var(--rs-bg);
    color: inherit;
    border-radius: 999px;
    padding: 4px 10px;
  }
}

.reader__hint {
  padding: 24px;
  color: var(--rs-muted);
}

.reader__key {
  margin: 0;
  padding: 8px 16px;
  background: var(--rs-surface);
  color: var(--rs-muted);
  font-size: 14px;

  button {
    margin-left: 8px;
    border: 0;
    background: transparent;
    color: var(--rs-accent);
  }
}

.reader__body {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
}

.reader__scroll {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 24px 22px 48px;
}

.reader__pager {
  display: flex;
  justify-content: space-between;
  margin-top: 28px;

  button {
    border: 1px solid var(--rs-border);
    background: var(--rs-surface);
    color: inherit;
    border-radius: 999px;
    padding: 8px 14px;
  }

  button:disabled {
    opacity: 0.4;
  }
}

.reader__danmaku {
  flex: none;
  margin: 0 16px 12px;
  border: 0;
  border-radius: 999px;
  padding: 8px 14px;
  background: var(--rs-surface);
  color: var(--rs-text);
  text-align: left;
  opacity: 0.92;
}

.reader__notes {
  padding: 16px;

  textarea {
    display: block;
    width: 100%;
    margin: 8px 0;
  }
}

.reader__rail {
  display: none;
}

@media (min-width: 960px) {
  .reader__body {
    width: min(100%, calc(42rem + 320px));
    margin: 0 auto;
  }

  .reader__scroll {
    max-width: 42rem;
  }

  .reader__rail {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 320px;
    flex: none;
    border-left: 1px solid var(--rs-border);
    padding: 24px 16px;
    color: var(--rs-muted);
    overflow: auto;
  }
}
</style>

<style lang="less">
.reader__sheet {
  height: 62vh;
  overflow: auto;
  background: var(--rs-bg, #fff);
}
</style>
