<template>
  <div class="archive">
    <VanNavBar title="书圈档案" left-arrow @click-left="goBack" />
    <p v-if="missing" class="archive__hint">找不到这本书。</p>
    <div v-else class="archive__body">
      <section>
        <h2>外号</h2>
        <p v-if="memory.nicknames.length === 0">还没有外号。</p>
        <label v-for="(item, index) in memory.nicknames" :key="`nick-${index}`" class="archive__row">
          <input v-model="item.character" aria-label="人物" />
          <input v-model="item.nickname" aria-label="外号" />
          <button type="button" @click="memory.nicknames.splice(index, 1)">删除</button>
        </label>
      </section>
      <section>
        <h2>名场面</h2>
        <p v-if="memory.scenes.length === 0">还没有名场面。</p>
        <label v-for="(item, index) in memory.scenes" :key="`scene-${index}`" class="archive__row">
          <input v-model="item.label" aria-label="名场面" />
          <button type="button" @click="memory.scenes.splice(index, 1)">删除</button>
        </label>
      </section>
      <section>
        <h2>预测</h2>
        <p v-if="memory.predictions.length === 0">还没有预测。</p>
        <label v-for="(item, index) in memory.predictions" :key="item.id" class="archive__row">
          <input v-model="item.content" aria-label="预测" />
          <span>{{ item.status }}</span>
          <button type="button" @click="memory.predictions.splice(index, 1)">删除</button>
        </label>
      </section>
      <button type="button" @click="save">保存修改</button>
      <p v-if="saved">已保存。</p>
      <label class="archive__export">
        <input v-model="includeReplies" type="checkbox" />
        导出时带上书友回复
      </label>
      <button type="button" @click="download">导出 Markdown</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NavBar as VanNavBar } from 'vant'
import { buildReadingMarkdown, paragraphOpening } from '@/core/export/markdown'
import { emptyMemory } from '@/core/memory'
import { readMemory, writeMemory } from '@/db/repos/comments'
import { getBook, listChapters, listParagraphs } from '@/db/repos/library'
import { listNotes } from '@/db/repos/notes'
import { listThreads } from '@/db/repos/comments'
import { platform } from '@/platform'
import type { BookMemory } from '@/core/types'

const route = useRoute()
const router = useRouter()
const missing = ref(false)
const saved = ref(false)
const includeReplies = ref(false)
const memory = reactive<BookMemory>(emptyMemory(''))
let entities: string[] = []
let title = ''
let translator = ''
let station: number | null = null

onMounted(async () => {
  const bookId = String(route.params.bookId)
  const book = await getBook(bookId)
  if (!book) {
    missing.value = true
    return
  }
  title = book.title
  translator = book.translator
  station = book.station
  const loaded = await readMemory(bookId)
  entities = loaded.entities
  Object.assign(memory, loaded.memory)
})

async function save() {
  memory.nicknames = memory.nicknames.filter((item) => item.nickname.trim() || item.character.trim())
  memory.scenes = memory.scenes.filter((item) => item.label.trim())
  memory.predictions = memory.predictions.filter((item) => item.content.trim())
  memory.updatedAt = new Date().toISOString()
  await writeMemory(memory, entities)
  saved.value = true
}

async function download() {
  const bookId = String(route.params.bookId)
  const chapters = await listChapters(bookId)
  const notes = await listNotes(bookId)
  const exported = []
  for (const chapter of chapters) {
    const paragraphs = await listParagraphs(chapter.id)
    const chapterNotes = notes.filter((note) => note.chapterId === chapter.id && note.type === '划线批注')
    const micro = notes.find((note) => note.chapterId === chapter.id && note.type === '本章微评')
    const comments = []
    for (const paragraph of paragraphs) {
      const threads = await listThreads(paragraph.id)
      for (const thread of threads) {
        if (thread.authorType !== 'user') continue
        comments.push({
          text: thread.text,
          replies: thread.replies.map((reply) => `${reply.displayName}：${reply.text}`),
        })
      }
    }
    exported.push({
      title: chapter.title,
      notes: chapterNotes.map((note) => ({
        opening: paragraphOpening(paragraphs.find((item) => item.id === note.paragraphId)?.text ?? note.quote ?? ''),
        text: note.text,
      })),
      comments,
      micro: micro
        ? {
            judgment: micro.judgment ?? '',
            evidence: micro.evidence ?? '',
            reservation: micro.reservation ?? '',
          }
        : undefined,
    })
  }
  const day = new Date().toISOString().slice(0, 10)
  const markdown = buildReadingMarkdown({
    title,
    translator,
    station,
    exportedAt: day,
    chapters: exported,
    includeReplies: includeReplies.value,
  })
  await platform.exportTextFile(`${title || '书友席'}-笔记.md`, markdown)
}

function goBack() {
  router.back()
}
</script>

<style scoped lang="less">
.archive__body {
  padding: 16px;
}

.archive__row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;

  input {
    flex: 1;
  }
}

.archive__hint,
.archive__export {
  padding: 16px;
}
</style>
