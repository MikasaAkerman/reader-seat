<template>
  <div class="archive">
    <VanNavBar title="书圈档案" left-arrow @click-left="goBack" />
    <VanEmpty v-if="missing" description="找不到这本书" />
    <div v-else class="archive__body">
      <VanCellGroup inset title="外号">
        <VanCell v-if="memory.nicknames.length === 0" title="还没有外号" class="archive__empty" />
        <VanField
          v-for="(item, index) in memory.nicknames"
          :key="`nick-${index}`"
          v-model="item.nickname"
          placeholder="外号"
          aria-label="外号"
        >
          <template #label>
            <input v-model="item.character" class="archive__inline" placeholder="人物" aria-label="人物" />
          </template>
          <template #button>
            <IconButton icon="delete-o" label="删除外号" variant="muted" @click="memory.nicknames.splice(index, 1)" />
          </template>
        </VanField>
      </VanCellGroup>

      <VanCellGroup inset title="名场面">
        <VanCell v-if="memory.scenes.length === 0" title="还没有名场面" class="archive__empty" />
        <VanField
          v-for="(item, index) in memory.scenes"
          :key="`scene-${index}`"
          v-model="item.label"
          type="textarea"
          rows="1"
          autosize
          placeholder="名场面"
          aria-label="名场面"
        >
          <template #button>
            <IconButton icon="delete-o" label="删除名场面" variant="muted" @click="memory.scenes.splice(index, 1)" />
          </template>
        </VanField>
      </VanCellGroup>

      <VanCellGroup inset title="预测">
        <VanCell v-if="memory.predictions.length === 0" title="还没有预测" class="archive__empty" />
        <VanField
          v-for="(item, index) in memory.predictions"
          :key="item.id"
          v-model="item.content"
          type="textarea"
          rows="1"
          autosize
          placeholder="预测"
          aria-label="预测"
        >
          <template #button>
            <span class="archive__actions">
              <VanTag :type="statusType(item.status)" plain round>{{ item.status }}</VanTag>
              <IconButton
                icon="delete-o"
                label="删除预测"
                variant="muted"
                @click="memory.predictions.splice(index, 1)"
              />
            </span>
          </template>
        </VanField>
      </VanCellGroup>

      <VanCellGroup inset title="导出">
        <VanCell title="带上书友回复" center>
          <template #right-icon>
            <VanSwitch v-model="includeReplies" size="20px" aria-label="导出时带上书友回复" />
          </template>
        </VanCell>
        <VanCell title="导出 Markdown 笔记" icon="description-o" is-link @click="download" />
      </VanCellGroup>

      <div class="archive__footer">
        <VanButton block round type="primary" :loading="saving" @click="save">保存修改</VanButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Button as VanButton,
  Cell as VanCell,
  CellGroup as VanCellGroup,
  Empty as VanEmpty,
  Field as VanField,
  NavBar as VanNavBar,
  Switch as VanSwitch,
  Tag as VanTag,
  showFailToast,
  showSuccessToast,
  type TagType,
} from 'vant'
import IconButton from '@/components/common/IconButton.vue'
import { buildReadingMarkdown, paragraphOpening } from '@/core/export/markdown'
import { emptyMemory } from '@/core/memory'
import { readMemory, writeMemory } from '@/db/repos/comments'
import { getBook, listChapters, listParagraphs } from '@/db/repos/library'
import { listNotes } from '@/db/repos/notes'
import { listThreads } from '@/db/repos/comments'
import { platform } from '@/platform'
import type { BookMemory, PredictionStatus } from '@/core/types'

const route = useRoute()
const router = useRouter()
const missing = ref(false)
const saving = ref(false)
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

function statusType(status: PredictionStatus): TagType {
  if (status === '应验') return 'success'
  if (status === '打脸') return 'danger'
  return 'default'
}

async function save() {
  memory.nicknames = memory.nicknames.filter((item) => item.nickname.trim() || item.character.trim())
  memory.scenes = memory.scenes.filter((item) => item.label.trim())
  memory.predictions = memory.predictions.filter((item) => item.content.trim())
  memory.updatedAt = new Date().toISOString()
  saving.value = true
  try {
    await writeMemory(memory, entities)
    showSuccessToast('已保存')
  } catch (err) {
    showFailToast(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
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
.archive {
  min-height: 100vh;
  background: var(--rs-bg);
}

.archive__body {
  max-width: 640px;
  margin: 0 auto;
  padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px));
}

.archive__empty :deep(.van-cell__title) {
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);
}

.archive__inline {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rs-muted);
  font: inherit;
  outline: none;

  &:focus {
    color: var(--rs-text);
  }
}

.archive__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-1);
}

:deep(.van-field__button) {
  display: flex;
  align-items: center;
  margin: -8px -8px -8px 0;
}

.archive__footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: var(--rs-space-3) var(--rs-space-4) calc(var(--rs-space-3) + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(to top, var(--rs-bg) 70%, transparent);

  .van-button {
    max-width: 608px;
    margin: 0 auto;
  }
}
</style>
