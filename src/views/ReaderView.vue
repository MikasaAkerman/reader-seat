<template>
  <div class="reader">
    <VanNavBar :title="book?.title || '阅读'" left-arrow @click-left="goLibrary">
      <template #right>
        <button class="reader__tool" type="button" @click="tocOpen = true">目录</button>
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
    </div>

    <p v-if="error" class="reader__hint">{{ error }}</p>

    <div v-else class="reader__body">
      <div ref="scrollEl" class="reader__scroll" @scroll="onScroll">
        <ChapterContent :title="chapterTitle" :paragraphs="shown" />
        <div class="reader__pager">
          <button type="button" :disabled="!prevChapter" @click="goChapter(prevChapter?.id)">上一章</button>
          <button type="button" :disabled="!nextChapter" @click="goChapter(nextChapter?.id)">下一章</button>
        </div>
      </div>
      <aside class="reader__rail">
        <strong>评论</strong>
        <p>读到后面，书友会写在这里。</p>
      </aside>
    </div>

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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NavBar as VanNavBar, Popup as VanPopup } from 'vant'
import { loadChapterImages } from '@/core/epub'
import ChapterContent from '@/components/reader/ChapterContent.vue'
import {
  getBook,
  getReadingState,
  listChapters,
  listParagraphs,
  recordProgress,
  type ProgressInput,
} from '@/db/repos/library'
import type { BookRow, ChapterRow, ParagraphRow, ReadingStateRow } from '@/db/schema'
import { platform } from '@/platform'
import { useSettingsStore, type ReaderTheme } from '@/stores/settings'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const scrollEl = ref<HTMLElement | null>(null)
const book = ref<BookRow | null>(null)
const chapters = ref<ChapterRow[]>([])
const shown = ref<ParagraphRow[]>([])
const error = ref('')
const tocOpen = ref(false)
const displayOpen = ref(false)
const urls: string[] = []

let observer: IntersectionObserver | null = null
let readFloor = 0
let ignore = false
let timer = 0
let pending: ProgressInput | null = null

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

watch(
  () => route.fullPath,
  () => {
    void load()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  observer?.disconnect()
  revokeUrls()
  void flush()
})

async function load() {
  error.value = ''
  const found = await getBook(bookId.value)
  if (!found) {
    error.value = '找不到这本书'
    return
  }
  book.value = found
  chapters.value = await listChapters(bookId.value)
  const state = await getReadingState(bookId.value)
  const target = chapterId.value || state?.chapterId || chapters.value[0]?.id || ''
  if (!target) {
    error.value = '这本书没有章节'
    return
  }
  if (target !== chapterId.value) {
    await router.replace({ name: 'reader', params: { bookId: bookId.value, chapterId: target } })
    return
  }
  await showChapter(target, state)
}

async function showChapter(id: string, state: ReadingStateRow | undefined) {
  await flush()
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
  })
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
      }
      queueSave()
    },
    { root, threshold: [0, 1] },
  )
  for (const node of root.querySelectorAll('[data-order]')) observer.observe(node)
}

function onScroll() {
  queueSave()
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
  readFloor = readUpTo
  const last = nodes[nodes.length - 1]
  return {
    chapterId: chapterId.value,
    paragraphIndex,
    offsetRatio,
    readUpTo,
    chapterLength: Number(last?.dataset.order ?? 0),
  }
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
}

function goChapter(id: string | undefined) {
  if (!id) return
  tocOpen.value = false
  void router.push({ name: 'reader', params: { bookId: bookId.value, chapterId: id } })
}

function goLibrary() {
  void router.push({ name: 'library' })
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

function imageSrcs(html: string): string[] {
  const holder = document.createElement('div')
  holder.innerHTML = html
  return [...holder.querySelectorAll('img')]
    .map((img) => img.getAttribute('src') ?? '')
    .filter((src) => src.length > 0)
}

function rewriteImages(html: string, map: Map<string, string>): string {
  const holder = document.createElement('div')
  holder.innerHTML = html
  for (const img of holder.querySelectorAll('img')) {
    const src = img.getAttribute('src')
    const next = src ? map.get(src) : undefined
    if (next) img.setAttribute('src', next)
  }
  return holder.innerHTML
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
  }
}
</style>
