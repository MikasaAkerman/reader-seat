<template>
  <div class="library">
    <VanNavBar title="书友席">
      <template #right>
        <button class="library__link" type="button" @click="goPhase0">阶段 0</button>
        <button class="library__link" type="button" @click="goSettings">设置</button>
      </template>
    </VanNavBar>

    <p v-if="store.error" class="library__hint">{{ store.error }}</p>

    <div v-if="store.books.length === 0" class="library__empty">
      <p>还没有书。</p>
      <VanButton type="primary" round @click="importBook">导入 EPUB</VanButton>
    </div>

    <ul v-else class="library__list">
      <li v-for="book in store.books" :key="book.id" class="library__item">
        <button class="library__book" type="button" @click="openBook(book.id)">
          <span class="library__cover">{{ book.title.slice(0, 1) }}</span>
          <span>
            <strong>{{ book.title }}</strong>
            <small>{{ book.author || '作者不详' }} · {{ book.progress }}</small>
          </span>
        </button>
        <button class="library__mini" type="button" @click="openSetup(book.id)">开书设置</button>
        <button class="library__mini library__mini--danger" type="button" @click="removeBook(book.id)">
          删除
        </button>
      </li>
    </ul>

    <button v-if="store.books.length > 0" class="library__import" type="button" @click="importBook">
      导入 EPUB
    </button>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast, Button as VanButton, NavBar as VanNavBar } from 'vant'
import { useLibraryStore } from '@/stores/library'

const router = useRouter()
const store = useLibraryStore()

onMounted(() => {
  void store.refresh()
})

async function importBook() {
  const outcome = await store.importBook()
  if (!outcome) {
    if (store.error) showToast(store.error)
    return
  }
  if (outcome.status === 'created') {
    await router.push({ name: 'book-setup', params: { bookId: outcome.bookId } })
    return
  }
  const text = outcome.status === 'updated' ? '已按新版本更新这本书' : '这本书已经在书架上'
  showToast(text)
  await router.push({ name: 'reader', params: { bookId: outcome.bookId } })
}

function openBook(bookId: string) {
  void router.push({ name: 'reader', params: { bookId } })
}

function openSetup(bookId: string) {
  void router.push({ name: 'book-setup', params: { bookId } })
}

async function removeBook(bookId: string) {
  try {
    await showConfirmDialog({ title: '删除这本书', message: '章节、阅读位置和原文件会一起删掉。' })
  } catch {
    return
  }
  await store.remove(bookId)
}

function goSettings() {
  void router.push({ name: 'settings' })
}

function goPhase0() {
  void router.push({ name: 'phase0' })
}
</script>

<style scoped lang="less">
.library {
  min-height: 100vh;
  background: var(--rs-bg);
}

.library__link {
  border: 0;
  background: transparent;
  color: var(--rs-accent);
  font-size: 14px;
  margin-left: 12px;
}

.library__hint,
.library__empty {
  padding: 32px 24px;
  color: var(--rs-muted);
  text-align: center;
}

.library__list {
  list-style: none;
  margin: 0;
  padding: 12px 16px 80px;
}

.library__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid var(--rs-border);
}

.library__book {
  flex: 1;
  display: flex;
  gap: 12px;
  align-items: center;
  border: 0;
  background: transparent;
  text-align: left;
  color: inherit;
  min-width: 0;

  strong,
  small {
    display: block;
  }

  small {
    color: var(--rs-muted);
    margin-top: 4px;
  }
}

.library__cover {
  width: 48px;
  height: 64px;
  border-radius: 4px;
  background: var(--rs-accent);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex: none;
}

.library__mini {
  border: 0;
  background: transparent;
  color: var(--rs-accent);
  font-size: 13px;
}

.library__mini--danger {
  color: #b91c1c;
}

.library__import {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: 16px;
  max-width: 480px;
  margin: 0 auto;
  height: 44px;
  border: 0;
  border-radius: 999px;
  background: var(--rs-accent);
  color: white;
  font-size: 16px;
}
</style>
