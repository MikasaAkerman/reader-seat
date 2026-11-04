<template>
  <div class="phase0">
    <VanNavBar title="阶段 0" left-arrow @click-left="goHome">
      <template #right>
        <button class="phase0__export" type="button" @click="pickImport">导入 JSON</button>
        <button class="phase0__export" type="button" @click="exportMarks">导出标注</button>
        <input
          ref="importEl"
          class="phase0__file"
          type="file"
          accept="application/json,.json"
          @change="importDocument"
        />
      </template>
    </VanNavBar>

    <p v-if="error" class="phase0__hint">{{ error }}</p>

    <div v-else ref="readerEl" class="phase0__reader">
      <p v-for="paragraph in paragraphs" :key="paragraph.index" class="phase0__p">
        <span>{{ paragraph.text }}</span>
        <button
          v-if="countOf(paragraph) > 0"
          type="button"
          class="phase0__bubble"
          :class="{ 'phase0__bubble--hot': paragraph.score === 3 }"
          @click="openParagraph(paragraph)"
        >
          {{ countOf(paragraph) }}
        </button>
      </p>
    </div>

    <VanPopup
      v-model:show="panelOpen"
      position="bottom"
      round
      :lock-scroll="false"
      class="phase0__panel"
    >
      <div v-if="active" class="phase0__panel-body">
        <header class="phase0__panel-title">段评 {{ countOf(active) }}</header>
        <article v-for="comment in active.comments" :key="comment.id" class="phase0__thread">
          <CommentBlock :comment="comment" :mark="marks[comment.id]" @mark="setMark" />
          <div v-for="reply in comment.replies" :key="reply.id" class="phase0__reply">
            <CommentBlock :comment="reply" :mark="marks[reply.id]" @mark="setMark" />
          </div>
        </article>
      </div>
    </VanPopup>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NavBar as VanNavBar, Popup as VanPopup, showToast } from 'vant'
import CommentBlock from '@/components/reader/CommentBlock.vue'
import {
  buildPhase0Export,
  bumpOpens,
  type Phase0Mark,
} from '@/core/generation/annotations'
import type { Phase0Document, Phase0Paragraph } from '@/core/generation/phase0'
import { phase0DocumentSchema } from '@/core/generation/phase0-schema'
import { getSetting, setSetting } from '@/db/repos/settings'
import { platform } from '@/platform'

const MARK_KEY = 'phase0-annotations'
const OPENS_KEY = 'phase0-opens'
const DOCUMENT_KEY = 'phase0.document'

const router = useRouter()
const readerEl = ref<HTMLElement | null>(null)
const importEl = ref<HTMLInputElement | null>(null)
const paragraphs = ref<Phase0Paragraph[]>([])
const promptVersion = ref(0)
const error = ref('')
const panelOpen = ref(false)
const active = ref<Phase0Paragraph | null>(null)
const marks = ref<Record<string, Phase0Mark>>({})

function applyDocument(doc: Phase0Document) {
  paragraphs.value = doc.paragraphs
  promptVersion.value = doc.promptVersion
  error.value = ''
}

function readOpens(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPENS_KEY) || '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const opens: Record<string, number> = {}
    for (const [day, count] of Object.entries(parsed)) {
      if (typeof count === 'number') opens[day] = count
    }
    return opens
  } catch {
    return {}
  }
}

onMounted(async () => {
  const saved = localStorage.getItem(MARK_KEY)
  if (saved) {
    try {
      marks.value = JSON.parse(saved) as Record<string, Phase0Mark>
    } catch {
      marks.value = {}
    }
  }
  const stored = phase0DocumentSchema.safeParse(await getSetting(DOCUMENT_KEY))
  if (stored.success) {
    applyDocument(stored.data)
    return
  }
  const res = await fetch('/phase0/comments.json')
  if (!res.ok) {
    error.value = '还没有评论数据。运行 pnpm phase0 生成，或点右上角导入 JSON。'
    return
  }
  const fetched = phase0DocumentSchema.safeParse(await res.json())
  if (!fetched.success) {
    error.value = 'comments.json 格式不对。可以重新生成，或导入一份阶段 0 JSON。'
    return
  }
  applyDocument(fetched.data)
})

function countOf(paragraph: Phase0Paragraph): number {
  return paragraph.comments.reduce((sum, comment) => sum + 1 + comment.replies.length, 0)
}

function openParagraph(paragraph: Phase0Paragraph) {
  const top = readerEl.value?.scrollTop ?? 0
  localStorage.setItem(OPENS_KEY, JSON.stringify(bumpOpens(readOpens())))
  active.value = paragraph
  panelOpen.value = true
  requestAnimationFrame(() => {
    if (readerEl.value) readerEl.value.scrollTop = top
  })
}

function setMark(id: string, mark: Phase0Mark) {
  marks.value = { ...marks.value, [id]: mark }
  localStorage.setItem(MARK_KEY, JSON.stringify(marks.value))
}

function pickImport() {
  importEl.value?.click()
}

async function importDocument(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const doc = phase0DocumentSchema.parse(JSON.parse(await file.text()) as unknown)
    await setSetting(DOCUMENT_KEY, doc)
    applyDocument(doc)
    showToast('已导入评论')
  } catch {
    showToast('这份 JSON 不是阶段 0 评论数据')
  }
}

async function exportMarks() {
  const payload = buildPhase0Export({
    promptVersion: promptVersion.value,
    opensByDay: readOpens(),
    marks: marks.value,
    paragraphs: paragraphs.value,
  })
  try {
    await platform.exportTextFile('phase0-annotations.json', JSON.stringify(payload, null, 2))
    showToast('已导出标注')
  } catch (err) {
    showToast(err instanceof Error ? err.message : '导出失败')
  }
}

function goHome() {
  void router.push({ name: 'library' })
}
</script>

<style scoped lang="less">
.phase0 {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--rs-bg);
}

.phase0__reader {
  flex: 1;
  overflow: auto;
  padding: 20px 22px 48px;
  max-width: 680px;
  margin: 0 auto;
  width: 100%;
}

.phase0__p {
  margin: 0 0 18px;
  font-size: 18px;
  line-height: 1.85;
}

.phase0__bubble {
  margin-left: 8px;
  border: 1px solid var(--rs-border);
  background: var(--rs-surface);
  color: var(--rs-accent);
  border-radius: 999px;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  vertical-align: middle;
}

.phase0__bubble--hot {
  background: #ccfbf1;
  border-color: #0f766e;
  font-weight: 700;
}

.phase0__hint {
  padding: 24px;
  color: var(--rs-muted);
  line-height: 1.6;
}

.phase0__export {
  border: 0;
  background: transparent;
  color: var(--rs-accent);
  font-size: 14px;
}

.phase0__file {
  display: none;
}

.phase0__panel-body {
  max-height: 55vh;
  overflow: auto;
  padding: 16px 16px 28px;
}

.phase0__panel-title {
  font-weight: 700;
  margin-bottom: 12px;
}

.phase0__thread {
  padding: 12px 0;
  border-top: 1px solid var(--rs-border);
}

.phase0__reply {
  margin-left: 16px;
  margin-top: 10px;
  padding-left: 10px;
  border-left: 2px solid var(--rs-border);
}
</style>
