<template>
  <section class="panel">
    <header class="panel__title">
      <span>段评</span>
      <button type="button" @click="emit('close')">关闭</button>
    </header>
    <p v-if="pending && threads.length === 0" class="panel__empty">书友正在写。</p>
    <p v-else-if="failed && threads.length === 0" class="panel__empty">这段没能生成。</p>
    <p v-else-if="threads.length === 0" class="panel__empty">这段还没有评论。</p>
    <ThreadItem v-for="thread in threads" :key="thread.id" :thread="thread" />
    <button v-if="failed" class="panel__retry" type="button" @click="emit('retry')">重试</button>
  </section>
</template>

<script setup lang="ts">
import type { ReaderThread } from '@/db/repos/comments'
import ThreadItem from './ThreadItem.vue'

defineProps<{
  threads: ReaderThread[]
  pending: boolean
  failed: boolean
}>()

const emit = defineEmits<{
  retry: []
  close: []
}>()
</script>

<style scoped lang="less">
.panel {
  padding: 8px 16px 24px;
  color: var(--rs-text, #1c1917);
}

.panel__title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0;
  font-size: 16px;

  button {
    border: 0;
    background: transparent;
    color: var(--rs-accent, #0f766e);
  }
}

.panel__empty {
  color: var(--rs-muted, #78716c);
}

.panel__retry {
  margin-top: 12px;
  border: 0;
  border-radius: 999px;
  padding: 8px 14px;
  background: var(--rs-accent, #0f766e);
  color: white;
}
</style>
