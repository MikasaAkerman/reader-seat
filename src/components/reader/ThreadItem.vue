<template>
  <article class="thread">
    <header class="thread__meta">
      <strong>{{ thread.displayName }}</strong>
      <span>AI 书友</span>
    </header>
    <p class="thread__text">{{ thread.text }}</p>
    <div v-if="shown.length > 0" class="thread__replies">
      <p v-for="reply in shown" :key="reply.id" class="thread__reply">
        <strong>{{ reply.displayName }}</strong>
        <span>AI 书友</span>
        {{ reply.text }}
      </p>
      <button v-if="hidden > 0 && !expanded" type="button" class="thread__more" @click="expanded = true">
        还有 {{ hidden }} 条回复
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ReaderThread } from '@/db/repos/comments'

const props = defineProps<{
  thread: ReaderThread
}>()

const expanded = ref(false)
const shown = computed(() => (expanded.value ? props.thread.replies : props.thread.replies.slice(0, 2)))
const hidden = computed(() => Math.max(0, props.thread.replies.length - 2))
</script>

<style scoped lang="less">
.thread {
  padding: 12px 0;
  border-bottom: 1px solid var(--rs-border, #e7e5e4);
}

.thread__meta,
.thread__reply span {
  color: var(--rs-accent, #0f766e);
  font-size: 12px;
}

.thread__meta {
  display: flex;
  gap: 8px;
  align-items: baseline;

  strong {
    color: var(--rs-text, #1c1917);
    font-size: 14px;
  }
}

.thread__text,
.thread__reply {
  margin: 6px 0 0;
  line-height: 1.6;
}

.thread__reply {
  padding-left: 12px;
  color: var(--rs-text, #1c1917);
  font-size: 14px;

  strong {
    margin-right: 6px;
  }

  span {
    margin-right: 6px;
  }
}

.thread__more {
  margin-top: 6px;
  border: 0;
  background: transparent;
  color: var(--rs-accent, #0f766e);
  padding: 0;
}
</style>
