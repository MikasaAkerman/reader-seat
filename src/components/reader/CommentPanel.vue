<template>
  <section class="panel" :style="{ paddingBottom: lift ? `${lift + 16}px` : undefined }">
    <header class="panel__title">
      <span>段评</span>
      <button type="button" @click="emit('close')">关闭</button>
    </header>
    <p v-if="locked" class="panel__empty">先写下你的看法，再看这段评论。</p>
    <template v-else>
      <p v-if="pending && threads.length === 0" class="panel__empty">书友正在写。</p>
      <p v-else-if="failed && threads.length === 0" class="panel__empty">这段没能生成。</p>
      <p v-else-if="threads.length === 0" class="panel__empty">这段还没有评论。</p>
      <ThreadItem
        v-for="thread in threads"
        :key="thread.id"
        :thread="thread"
        @reply="(id, name) => emit('reply', id, name)"
        @mark="(id, mark, on) => emit('mark', id, mark, on)"
      />
      <div v-if="batchCount > 1" class="panel__batches">
        <button type="button" @click="emit('batch', -1)">上一批</button>
        <span>第 {{ batchNo }} 批 / {{ batchCount }}</span>
        <button type="button" @click="emit('batch', 1)">下一批</button>
      </div>
      <button class="panel__retry" type="button" :disabled="rerollsLeft <= 0" @click="emit('reroll')">
        换一批<span v-if="rerollsLeft <= 0">（今天已用完）</span>
      </button>
      <p v-if="rerollMessage" class="panel__empty">{{ rerollMessage }}</p>
    </template>
    <p v-if="replying" class="panel__empty">书友正在接话。</p>
    <p v-if="replyFailed" class="panel__empty">书友没接上话。</p>
    <button v-if="failed" class="panel__retry" type="button" @click="emit('retry')">重试</button>
    <button v-if="replyFailed" class="panel__retry" type="button" @click="emit('retryReply')">重试</button>
    <form class="panel__composer" @submit.prevent="submit">
      <p v-if="replyTo" class="panel__replying">
        回复 {{ replyTo.name }}
        <button type="button" @click="emit('cancelReply')">取消</button>
      </p>
      <div class="panel__mentions">
        <button
          v-for="name in residents"
          :key="name"
          type="button"
          :class="{ 'is-on': mention === name }"
          @click="mention = mention === name ? '' : name"
        >
          @{{ name }}
        </button>
      </div>
      <textarea v-model="draft" rows="2" placeholder="写一句段评" />
      <button type="submit" :disabled="!draft.trim()">发送</button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CommentMarks, ReaderThread } from '@/db/repos/comments'
import ThreadItem from './ThreadItem.vue'

withDefaults(
  defineProps<{
    threads: ReaderThread[]
    pending: boolean
    failed: boolean
    locked?: boolean
    replying: boolean
    replyFailed: boolean
    residents: string[]
    replyTo: { id: string; name: string } | null
    batchNo?: number
    batchCount?: number
    rerollsLeft?: number
    rerollMessage?: string
  }>(),
  {
    locked: false,
    batchNo: 0,
    batchCount: 0,
    rerollsLeft: 3,
    rerollMessage: '',
  },
)

const emit = defineEmits<{
  retry: []
  retryReply: []
  close: []
  reply: [id: string, name: string]
  cancelReply: []
  mark: [id: string, mark: keyof CommentMarks, on: boolean]
  submit: [payload: { text: string; mention: string }]
  reroll: []
  batch: [offset: number]
}>()

const draft = ref('')
const mention = ref('')
const lift = ref(0)

function submit() {
  const text = draft.value.trim()
  if (!text) return
  emit('submit', { text, mention: mention.value })
  draft.value = ''
  mention.value = ''
}

function placeComposer() {
  const viewport = window.visualViewport
  if (!viewport) return
  lift.value = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
}

onMounted(() => {
  placeComposer()
  window.visualViewport?.addEventListener('resize', placeComposer)
  window.visualViewport?.addEventListener('scroll', placeComposer)
})

onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', placeComposer)
  window.visualViewport?.removeEventListener('scroll', placeComposer)
})
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

.panel__composer {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  background: var(--rs-bg, #fff);

  textarea {
    flex: 1;
    min-width: 12rem;
    border: 1px solid var(--rs-border, #e7e5e4);
    border-radius: 12px;
    padding: 8px;
    color: inherit;
    background: transparent;
  }

  button[type='submit'] {
    border: 0;
    border-radius: 999px;
    padding: 8px 14px;
    background: var(--rs-accent, #0f766e);
    color: white;
  }
}

.panel__mentions,
.panel__replying {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  margin: 0;
}

.panel__mentions button,
.panel__replying button {
  border: 0;
  background: transparent;
  color: var(--rs-accent, #0f766e);
  padding: 0;
}

.panel__mentions .is-on {
  font-weight: 700;
}
</style>
