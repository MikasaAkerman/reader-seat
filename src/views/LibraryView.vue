<template>
  <div class="library">
    <VanNavBar title="书友席">
      <template #right>
        <IconButton icon="setting-o" label="设置" @click="goSettings" />
      </template>
    </VanNavBar>

    <p v-if="store.error" class="library__error">{{ store.error }}</p>

    <VanEmpty v-if="store.books.length === 0" class="library__empty" description="书架还是空的">
      <VanButton type="primary" round icon="plus" @click="importBook">导入 EPUB</VanButton>
    </VanEmpty>

    <ul v-else class="library__list">
      <li v-for="book in store.books" :key="book.id" class="library__card">
        <button class="library__book" type="button" @click="openBook(book.id)">
          <span class="library__cover" :style="{ background: coverColor(book.title) }">
            {{ book.title.slice(0, 1) }}
          </span>
          <span class="library__meta">
            <strong class="library__title">{{ book.title }}</strong>
            <span class="library__author">{{ book.author || '作者不详' }}</span>
            <span class="library__progress" :class="{ 'library__progress--warn': book.fileMissing }">
              {{ book.progress }}
            </span>
            <span class="library__bar" aria-hidden="true">
              <span :style="{ width: `${Math.round(book.ratio * 100)}%` }" />
            </span>
          </span>
        </button>
        <IconButton icon="ellipsis" label="更多操作" variant="muted" @click="openActions(book)" />
      </li>
    </ul>

    <button v-if="store.books.length > 0" class="library__fab" type="button" @click="importBook">
      <VanIcon name="plus" />
      <span>导入 EPUB</span>
    </button>

    <VanActionSheet
      v-model:show="actionsOpen"
      :title="actionBook?.title"
      :actions="actions"
      cancel-text="取消"
      close-on-click-action
      @select="onAction"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  showConfirmDialog,
  showToast,
  ActionSheet as VanActionSheet,
  Button as VanButton,
  Empty as VanEmpty,
  Icon as VanIcon,
  NavBar as VanNavBar,
  type ActionSheetAction,
} from 'vant'
import IconButton from '@/components/common/IconButton.vue'
import type { BookCard } from '@/db/repos/library'
import { useLibraryStore } from '@/stores/library'

const COVER_COLORS = ['#9a5b3c', '#7c6a46', '#5f7161', '#8a4f5a', '#4f6d7a', '#a06f3a', '#6b5b7b', '#56735a']

const router = useRouter()
const store = useLibraryStore()
const actionsOpen = ref(false)
const actionBook = ref<BookCard | null>(null)
const actions: ActionSheetAction[] = [
  { name: '开书设置', icon: 'setting-o' },
  { name: '删除', icon: 'delete-o', color: 'var(--rs-danger)' },
]

onMounted(() => {
  void store.refresh()
})

function coverColor(title: string): string {
  let hash = 0
  for (const char of title) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return COVER_COLORS[hash % COVER_COLORS.length] ?? COVER_COLORS[0]!
}

async function importBook() {
  let outcome = await store.importBook()
  if (outcome?.status === 'conflict') outcome = await store.resolveConflict(await askConflict(outcome.title))
  if (!outcome) {
    if (store.error) showToast(store.error)
    return
  }
  if (outcome.status === 'created') {
    await router.push({ name: 'book-setup', params: { bookId: outcome.bookId } })
    return
  }
  if (outcome.status === 'conflict') return
  const text = outcome.status === 'updated' ? '已按新版本更新这本书' : '这本书已经在书架上'
  showToast(text)
  await router.push({ name: 'reader', params: { bookId: outcome.bookId } })
}

async function askConflict(title: string): Promise<'replace' | 'separate' | 'cancel'> {
  try {
    await showConfirmDialog({
      title: '书架上已有同名的书',
      message: `《${title}》已经在书架上，译者也相同。用新文件替换旧版本（评论和进度会尽量对到新版本上），还是作为另一本书导入？`,
      confirmButtonText: '替换为新版本',
      cancelButtonText: '作为另一本书',
      showCancelButton: true,
    })
    return 'replace'
  } catch (reason) {
    return reason === 'cancel' ? 'separate' : 'cancel'
  }
}

function openBook(bookId: string) {
  void router.push({ name: 'reader', params: { bookId } })
}

function openActions(book: BookCard) {
  actionBook.value = book
  actionsOpen.value = true
}

function onAction(action: ActionSheetAction) {
  const book = actionBook.value
  if (!book) return
  if (action.name === '开书设置') void router.push({ name: 'book-setup', params: { bookId: book.id } })
  else void removeBook(book)
}

async function removeBook(book: BookCard) {
  try {
    await showConfirmDialog({
      title: `删除《${book.title}》`,
      message: '章节、阅读位置和原文件会一起删掉。',
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--rs-danger)',
    })
  } catch {
    return
  }
  await store.remove(book.id)
}

function goSettings() {
  void router.push({ name: 'settings' })
}
</script>

<style scoped lang="less">
.library {
  min-height: 100vh;
  background: var(--rs-bg);
}

.library__error {
  margin: var(--rs-space-3) var(--rs-space-4) 0;
  padding: var(--rs-space-2) var(--rs-space-3);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  color: var(--rs-danger);
  font-size: var(--rs-text-sm);
}

.library__empty {
  padding-top: 15vh;
}

.library__list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--rs-space-3);
  max-width: 720px;
  list-style: none;
  margin: 0 auto;
  padding: var(--rs-space-4) var(--rs-space-4) 96px;
}

.library__card {
  display: flex;
  align-items: center;
  gap: var(--rs-space-1);
  padding: var(--rs-space-3);
  padding-right: var(--rs-space-1);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface);
  box-shadow: var(--rs-shadow-card);
}

.library__book {
  flex: 1;
  display: flex;
  gap: var(--rs-space-3);
  align-items: center;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.library__cover {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 70px;
  border-radius: 4px var(--rs-radius-sm) var(--rs-radius-sm) 4px;
  box-shadow: inset 3px 0 0 rgba(0, 0, 0, 0.12);
  color: #fffaf2;
  font-family: var(--rs-font-reading);
  font-size: 22px;
}

.library__meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.library__title,
.library__author,
.library__progress {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library__title {
  font-size: var(--rs-text-md);
  font-weight: 600;
}

.library__author,
.library__progress {
  color: var(--rs-muted);
  font-size: var(--rs-text-xs);
}

.library__progress--warn {
  color: var(--rs-danger);
}

.library__bar {
  display: block;
  height: 3px;
  margin-top: var(--rs-space-1);
  border-radius: 999px;
  background: var(--rs-border);
  overflow: hidden;

  span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--rs-accent);
  }
}

.library__fab {
  position: fixed;
  right: var(--rs-space-5);
  bottom: calc(var(--rs-space-5) + env(safe-area-inset-bottom, 0px));
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-1);
  height: 48px;
  padding: 0 var(--rs-space-5) 0 var(--rs-space-4);
  border: 0;
  border-radius: 999px;
  background: var(--rs-accent);
  color: var(--rs-on-accent);
  font: inherit;
  font-size: var(--rs-text-md);
  box-shadow: 0 6px 20px rgba(15, 118, 110, 0.28);
  cursor: pointer;

  .van-icon {
    font-size: 18px;
  }
}
</style>
