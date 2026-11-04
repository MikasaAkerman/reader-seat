<template>
  <article class="thread">
    <header class="thread__meta">
      <strong>{{ thread.displayName }}</strong>
      <span v-if="badge(thread.authorType)">{{ badge(thread.authorType) }}</span>
      <button type="button" @click="emit('reply', thread.id, thread.displayName)">回复</button>
    </header>
    <p class="thread__text">{{ thread.text }}</p>
    <div class="thread__marks">
      <button
        v-for="item in markButtons"
        :key="item.id"
        type="button"
        :class="{ 'is-on': thread.marks[item.id] }"
        @click="emit('mark', thread.id, item.id, !thread.marks[item.id])"
      >
        {{ item.label }}
      </button>
    </div>
    <div v-if="shown.length > 0" class="thread__replies">
      <div v-for="reply in shown" :key="reply.id" class="thread__reply">
        <strong>{{ reply.displayName }}</strong>
        <span v-if="badge(reply.authorType)">{{ badge(reply.authorType) }}</span>
        <button type="button" @click="emit('reply', reply.id, reply.displayName)">回复</button>
        <p>{{ reply.text }}</p>
        <div class="thread__marks">
          <button
            v-for="item in markButtons"
            :key="item.id"
            type="button"
            :class="{ 'is-on': reply.marks[item.id] }"
            @click="emit('mark', reply.id, item.id, !reply.marks[item.id])"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
      <button v-if="hidden > 0 && !expanded" type="button" class="thread__more" @click="expanded = true">
        还有 {{ hidden }} 条回复
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AuthorType } from '@/core/types'
import type { CommentMarks, ReaderThread } from '@/db/repos/comments'

const props = defineProps<{
  thread: ReaderThread
}>()

const emit = defineEmits<{
  reply: [id: string, name: string]
  mark: [id: string, mark: keyof CommentMarks, on: boolean]
}>()

const markButtons: { id: keyof CommentMarks; label: string }[] = [
  { id: 'saved', label: '收藏' },
  { id: 'boring', label: '无聊' },
  { id: 'spoiler', label: '剧透' },
  { id: 'wrong', label: '错误' },
]

const expanded = ref(false)
const shown = computed(() => (expanded.value ? props.thread.replies : props.thread.replies.slice(0, 2)))
const hidden = computed(() => Math.max(0, props.thread.replies.length - 2))

function badge(authorType: AuthorType): string {
  if (authorType === 'user') return ''
  if (authorType === 'resident') return '常驻 · AI 书友'
  return 'AI 书友'
}
</script>

<style scoped lang="less">
.thread {
  padding: 12px 0;
  border-bottom: 1px solid var(--rs-border, #e7e5e4);
}

.thread__meta,
.thread__reply span,
.thread__marks button,
.thread__more,
.thread__meta button,
.thread__reply button {
  color: var(--rs-accent, #0f766e);
  font-size: 12px;
}

.thread__meta,
.thread__reply {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}

.thread__meta strong,
.thread__reply strong {
  color: var(--rs-text, #1c1917);
  font-size: 14px;
}

.thread__meta button,
.thread__reply button,
.thread__marks button,
.thread__more {
  border: 0;
  background: transparent;
  padding: 0;
}

.thread__text,
.thread__reply p {
  margin: 6px 0 0;
  width: 100%;
  line-height: 1.6;
}

.thread__reply {
  padding-left: 12px;
  margin-top: 8px;
}

.thread__marks {
  display: flex;
  gap: 10px;
  width: 100%;
}

.thread__marks .is-on {
  font-weight: 700;
}
</style>
