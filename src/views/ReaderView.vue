<template>
  <div class="reader">
    <VanNavBar :title="book?.title || '阅读'" left-arrow @click-left="goLibrary">
      <template #right>
        <IconButton icon="bars" label="目录" @click="tocOpen = true" />
        <IconButton icon="records-o" label="书圈档案" @click="goArchive" />
        <IconButton icon="font-o" label="显示设置" :active="displayOpen" @click="displayOpen = true" />
      </template>
    </VanNavBar>

    <button v-if="generation.needsKey" class="reader__key" type="button" @click="goSettings">
      <VanIcon name="info-o" />
      <span>没有 API Key，书友暂不发言</span>
      <span class="reader__key-link">去设置<VanIcon name="arrow" /></span>
    </button>

    <VanEmpty v-if="error" :description="error" />

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
        <nav class="reader__pager" aria-label="翻章">
          <button
            class="reader__page reader__page--prev"
            type="button"
            :disabled="!prevChapter"
            @click="goChapter(prevChapter?.id)"
          >
            <VanIcon name="arrow-left" />
            <span>
              <small>上一章</small>
              <strong>{{ prevChapter?.title ?? '已是第一章' }}</strong>
            </span>
          </button>
          <button
            class="reader__page reader__page--next"
            type="button"
            :disabled="!nextChapter"
            @click="goChapter(nextChapter?.id)"
          >
            <span>
              <small>下一章</small>
              <strong>{{ nextChapter?.title ?? '已是最后一章' }}</strong>
            </span>
            <VanIcon name="arrow" />
          </button>
        </nav>
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
          :allow-reroll="shortOn"
          :allow-deep="longOn"
          @retry="onRetry(comments.activeId)"
          @retry-reply="generation.retryReply()"
          @reply="startReply"
          @cancel-reply="replyTo = null"
          @mark="onMark"
          @submit="onSubmit"
          @reroll="onReroll"
          @batch="onBatch"
          @background="onBackground"
          @deep="onDeep"
          @close="closeComments"
        />
        <div v-else class="reader__rail-empty">
          <VanIcon name="chat-o" />
          <span>点段末气泡看段评</span>
        </div>
      </aside>
    </div>

    <VanPopup
      v-if="!wide"
      v-model:show="panelOpen"
      position="bottom"
      round
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
        :allow-reroll="shortOn"
        :allow-deep="longOn"
        @retry="onRetry(comments.activeId)"
        @retry-reply="generation.retryReply()"
        @reply="startReply"
        @cancel-reply="replyTo = null"
        @mark="onMark"
        @submit="onSubmit"
        @reroll="onReroll"
        @batch="onBatch"
        @background="onBackground"
        @deep="onDeep"
        @close="closeComments"
      />
    </VanPopup>

    <button v-if="danmaku" class="reader__danmaku" type="button" @click="openDanmaku">
      <VanIcon name="fire-o" />
      <span>{{ danmaku.text }}</span>
    </button>

    <VanPopup v-model:show="displayOpen" position="bottom" round :lock-scroll="false" class="reader__display">
      <div class="reader__display-row">
        <span class="reader__display-label">字号</span>
        <VanSlider
          :model-value="settings.display.fontSize"
          :min="16"
          :max="24"
          :step="1"
          bar-height="3px"
          button-size="20px"
          @update:model-value="onFont"
        />
        <span class="reader__display-value">{{ settings.display.fontSize }}</span>
      </div>
      <div class="reader__display-row">
        <span class="reader__display-label">行距</span>
        <VanSlider
          :model-value="settings.display.lineHeight"
          :min="1.6"
          :max="2.2"
          :step="0.1"
          bar-height="3px"
          button-size="20px"
          @update:model-value="onLine"
        />
        <span class="reader__display-value">{{ settings.display.lineHeight.toFixed(1) }}</span>
      </div>
      <div class="reader__display-row">
        <span class="reader__display-label">主题</span>
        <div class="reader__swatches" role="radiogroup" aria-label="阅读主题">
          <button
            v-for="item in themes"
            :key="item.id"
            class="reader__swatch"
            :class="[`reader__swatch--${item.id}`, { 'reader__swatch--on': settings.display.theme === item.id }]"
            type="button"
            role="radio"
            :aria-checked="settings.display.theme === item.id"
            @click="onTheme(item.id)"
          >
            <span>{{ item.name }}</span>
          </button>
        </div>
      </div>
      <div class="reader__display-row">
        <span class="reader__display-label">弹幕</span>
        <span class="reader__display-hint">热段滑过时飘一句</span>
        <VanSwitch
          size="20px"
          :model-value="settings.display.danmaku"
          aria-label="热段弹幕"
          @update:model-value="onDanmaku"
        />
      </div>
      <button class="reader__display-notes" type="button" @click="openNotes">
        <VanIcon name="edit" />
        <span>本章批注</span>
        <span class="reader__display-count">{{ chapterNotes.length }}</span>
        <VanIcon name="arrow" />
      </button>
    </VanPopup>

    <VanPopup v-model:show="notesOpen" position="bottom" round :lock-scroll="false" class="reader__sheet">
      <section class="reader__notes">
        <header class="reader__sheet-head">
          <h2>本章批注</h2>
          <IconButton icon="cross" label="关闭" variant="muted" @click="notesOpen = false" />
        </header>
        <VanEmpty v-if="chapterNotes.length === 0" image-size="64" description="长按选中文字即可划线批注" />
        <ul v-else class="reader__note-list">
          <li v-for="note in chapterNotes" :key="note.id">
            <blockquote>{{ note.quote }}</blockquote>
            <p>{{ note.text }}</p>
          </li>
        </ul>
      </section>
    </VanPopup>

    <VanPopup v-model:show="highlightOpen" position="bottom" round :lock-scroll="false">
      <form class="reader__notes" @submit.prevent="saveHighlightNote">
        <header class="reader__sheet-head">
          <h2>划线批注</h2>
          <IconButton icon="cross" label="关闭" variant="muted" @click="highlightDraft = null" />
        </header>
        <blockquote v-if="highlightDraft">{{ highlightDraft.quote }}</blockquote>
        <VanField
          v-model="noteText"
          class="reader__field"
          type="textarea"
          rows="3"
          autosize
          placeholder="写一句批注"
          aria-label="批注内容"
        />
        <VanButton block round type="primary" native-type="submit" :disabled="!noteText.trim()">保存</VanButton>
      </form>
    </VanPopup>

    <VanPopup v-model:show="footnoteOpen" position="bottom" round :lock-scroll="false">
      <section v-if="footnote" class="reader__notes">
        <header class="reader__sheet-head">
          <h2>注释</h2>
          <IconButton icon="cross" label="关闭" variant="muted" @click="footnote = null" />
        </header>
        <p class="reader__footnote">{{ footnote.text }}</p>
        <VanButton v-if="footnote.here" block round plain type="primary" @click="jumpToFootnote">跳到这一段</VanButton>
      </section>
    </VanPopup>

    <VanPopup v-model:show="tocOpen" position="left" :lock-scroll="false" :z-index="3100" class="reader__toc">
      <header class="reader__toc-head">
        <strong>{{ book?.title }}</strong>
        <small>{{ chapters.length }} 章</small>
      </header>
      <ul>
        <li v-for="chapter in chapters" :key="chapter.id">
          <button
            type="button"
            :class="{ 'reader__toc-item--current': chapter.id === chapterId }"
            :aria-current="chapter.id === chapterId ? 'page' : undefined"
            @click="goChapter(chapter.id)"
          >
            <span>{{ chapter.title }}</span>
            <VanIcon v-if="chapter.readStatus === 'done'" name="success" class="reader__toc-done" aria-label="已读完" />
          </button>
        </li>
      </ul>
    </VanPopup>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Button as VanButton,
  Empty as VanEmpty,
  Field as VanField,
  Icon as VanIcon,
  NavBar as VanNavBar,
  Popup as VanPopup,
  Slider as VanSlider,
  Switch as VanSwitch,
  showToast,
} from 'vant'
import { findLinkTarget, imageSrcs, loadChapterImages, resolveBookLink, rewriteImages } from '@/core/epub'
import { paragraphOpening } from '@/core/export/markdown'
import { lineupFor } from '@/core/generation/pipeline'
import IconButton from '@/components/common/IconButton.vue'
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
const themes: { id: ReaderTheme; name: string }[] = [
  { id: 'day', name: '日间' },
  { id: 'eye', name: '护眼' },
  { id: 'night', name: '夜间' },
]
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
const shortOn = computed(() => book.value?.shortComments !== false)
const longOn = computed(() => book.value?.longComments !== false)
const residents = computed(() =>
  shortOn.value
    ? lineupFor(book.value?.spoilerLevel ?? '严格', book.value?.lineup).map((persona) => persona.role)
    : [],
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

async function onBackground() {
  const id = comments.activeId
  if (!id) return
  await generation.fetchBackground(id)
  if (generation.notice) showToast(generation.notice)
  await comments.open(id)
}

async function onDeep() {
  const id = comments.activeId
  if (!id) return
  await generation.requestDeep(id)
  if (generation.notice) showToast(generation.notice)
}

function onBatch(offset: number) {
  void comments.showBatch(offset)
}

function jumpTo(id: string) {
  scrollEl.value?.querySelector(`[data-paragraph-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
}

function onFont(value: number | [number, number]) {
  const fontSize = Array.isArray(value) ? value[0] : value
  void settings.saveDisplay({ ...settings.display, fontSize })
}

function onLine(value: number | [number, number]) {
  const lineHeight = Math.round((Array.isArray(value) ? value[0] : value) * 10) / 10
  void settings.saveDisplay({ ...settings.display, lineHeight })
}

function onTheme(theme: ReaderTheme) {
  void settings.saveDisplay({ ...settings.display, theme })
}

function onDanmaku(danmakuOn: boolean) {
  void settings.saveDisplay({ ...settings.display, danmaku: danmakuOn })
}

function openNotes() {
  displayOpen.value = false
  notesOpen.value = true
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

  .van-nav-bar__title {
    max-width: 50%;
  }

  .van-nav-bar__right {
    padding-right: var(--rs-space-1);
  }
}

.reader__key {
  display: flex;
  align-items: center;
  gap: var(--rs-space-2);
  width: 100%;
  padding: var(--rs-space-2) var(--rs-space-4);
  border: 0;
  border-bottom: 1px solid var(--rs-border);
  background: var(--rs-accent-soft);
  color: var(--rs-text);
  font: inherit;
  font-size: var(--rs-text-sm);
  text-align: left;
  cursor: pointer;

  > .van-icon {
    color: var(--rs-accent);
  }
}

.reader__key-link {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  color: var(--rs-accent);
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
  padding: var(--rs-space-5) 22px 48px;
}

.reader__pager {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--rs-space-3);
  margin-top: var(--rs-space-6);
}

.reader__page {
  display: flex;
  align-items: center;
  gap: var(--rs-space-2);
  min-width: 0;
  padding: var(--rs-space-3);
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface);
  color: var(--rs-text);
  font: inherit;
  cursor: pointer;

  > span {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  small {
    color: var(--rs-muted);
    font-size: var(--rs-text-xs);
  }

  strong {
    overflow: hidden;
    font-size: var(--rs-text-sm);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .van-icon {
    flex: none;
    color: var(--rs-muted);
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
}

.reader__page--prev {
  text-align: left;
}

.reader__page--next {
  text-align: right;
}

.reader__danmaku {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--rs-space-2);
  margin: 0 var(--rs-space-4) var(--rs-space-3);
  padding: var(--rs-space-2) var(--rs-space-4);
  border: 1px solid var(--rs-border);
  border-radius: 999px;
  background: var(--rs-surface);
  color: var(--rs-text);
  font: inherit;
  font-size: var(--rs-text-sm);
  text-align: left;
  box-shadow: var(--rs-shadow-card);
  opacity: 0.95;

  .van-icon {
    flex: none;
    color: var(--rs-accent);
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.reader__display {
  padding: var(--rs-space-4) var(--rs-space-5) var(--rs-space-5);
}

.reader__display-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-4);
  min-height: 48px;

  .van-slider {
    flex: 1;
  }
}

.reader__display-label {
  flex: none;
  width: 2.5em;
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);
}

.reader__display-value {
  width: 2em;
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.reader__display-hint {
  flex: 1;
  color: var(--rs-muted);
  font-size: var(--rs-text-xs);
}

.reader__swatches {
  display: flex;
  flex: 1;
  gap: var(--rs-space-3);
}

.reader__swatch {
  flex: 1;
  height: 40px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: var(--rs-radius-sm);
  font: inherit;
  font-size: var(--rs-text-sm);
  cursor: pointer;
}

.reader__swatch--day {
  background: #f7f4ef;
  color: #1c1917;
}

.reader__swatch--eye {
  background: #e7f0dc;
  color: #1c2416;
}

.reader__swatch--night {
  background: #1c1917;
  color: #ece7e2;
}

.reader__swatch--on {
  outline: 2px solid var(--rs-accent);
  outline-offset: 2px;
}

.reader__display-notes {
  display: flex;
  align-items: center;
  gap: var(--rs-space-2);
  width: 100%;
  margin-top: var(--rs-space-3);
  padding: var(--rs-space-3) var(--rs-space-4);
  border: 0;
  border-radius: var(--rs-radius-md);
  background: var(--rs-bg);
  color: var(--rs-text);
  font: inherit;
  font-size: var(--rs-text-md);
  cursor: pointer;

  > span:first-of-type {
    flex: 1;
    text-align: left;
  }

  .van-icon {
    color: var(--rs-muted);
  }
}

.reader__display-count {
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);
}

.reader__notes {
  padding: var(--rs-space-2) var(--rs-space-4) var(--rs-space-5);

  blockquote {
    margin: 0 0 var(--rs-space-3);
    padding-left: var(--rs-space-3);
    border-left: 3px solid var(--rs-accent);
    color: var(--rs-muted);
    font-family: var(--rs-font-reading);
    font-size: var(--rs-text-md);
    line-height: 1.7;
  }
}

.reader__sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--rs-space-2);

  h2 {
    margin: 0;
    font-size: var(--rs-text-md);
    font-weight: 600;
  }
}

.reader__note-list {
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    padding: var(--rs-space-3) 0;
    border-bottom: 1px solid var(--rs-border);
  }

  blockquote {
    margin-bottom: var(--rs-space-2);
  }

  p {
    margin: 0;
    font-size: var(--rs-text-md);
    line-height: 1.6;
  }
}

.reader__field {
  margin-bottom: var(--rs-space-4);
  padding: var(--rs-space-2) var(--rs-space-3);
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-md);
  background: var(--rs-bg);
}

.reader__footnote {
  margin: 0 0 var(--rs-space-4);
  font-family: var(--rs-font-reading);
  font-size: var(--rs-text-md);
  line-height: 1.75;
}

.reader__toc {
  display: flex;
  flex-direction: column;
  width: min(82vw, 340px);
  height: 100%;
  background: var(--rs-surface);

  ul {
    flex: 1;
    margin: 0;
    padding: var(--rs-space-2) 0 var(--rs-space-5);
    overflow: auto;
    list-style: none;
  }

  li button {
    display: flex;
    align-items: center;
    gap: var(--rs-space-2);
    width: 100%;
    min-height: 44px;
    padding: var(--rs-space-2) var(--rs-space-5);
    border: 0;
    background: transparent;
    color: var(--rs-text);
    font: inherit;
    font-size: var(--rs-text-md);
    text-align: left;
    cursor: pointer;

    span {
      flex: 1;
      min-width: 0;
    }
  }
}

.reader__toc-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--rs-space-5) var(--rs-space-5) var(--rs-space-3);
  border-bottom: 1px solid var(--rs-border);

  strong {
    font-size: var(--rs-text-lg);
  }

  small {
    color: var(--rs-muted);
    font-size: var(--rs-text-xs);
  }
}

.reader__toc .reader__toc-item--current {
  background: var(--rs-accent-soft);
  box-shadow: inset 3px 0 0 var(--rs-accent);
  color: var(--rs-accent);
  font-weight: 600;
}

.reader__toc-done {
  flex: none;
  color: var(--rs-muted);
  font-size: 14px;
}

.reader__rail {
  display: none;
}

.reader__rail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--rs-space-2);
  margin-top: 30vh;
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);

  .van-icon {
    font-size: 28px;
    opacity: 0.6;
  }
}

@media (min-width: 960px) {
  .reader__body {
    width: min(100%, calc(42rem + 360px));
    margin: 0 auto;
  }

  .reader__scroll {
    max-width: 42rem;
  }

  .reader__rail {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 360px;
    flex: none;
    border-left: 1px solid var(--rs-border);
    overflow: auto;
  }
}
</style>

<style lang="less">
.reader__sheet {
  height: 62vh;
  overflow: auto;
}
</style>
