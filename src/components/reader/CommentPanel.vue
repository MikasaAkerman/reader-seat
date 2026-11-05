<template>
  <section class="panel" :style="{ paddingBottom: lift ? `${lift + 16}px` : undefined }">
    <header class="panel__head">
      <h2 class="panel__title">
        段评
        <span v-if="!locked && total > 0" class="panel__count">{{ total }}</span>
      </h2>
      <IconButton icon="cross" label="关闭" variant="muted" @click="emit('close')" />
    </header>

    <div class="panel__body">
      <div v-if="locked" class="panel__state">
        <VanIcon name="lock" />
        <span>先写下你的看法，再看这段评论</span>
      </div>
      <template v-else>
        <div v-if="pending && threads.length === 0" class="panel__state">
          <VanLoading size="20px" />
          <span>书友正在写</span>
        </div>
        <div v-else-if="failed && threads.length === 0" class="panel__state">
          <VanIcon name="warning-o" />
          <span>这段没能生成</span>
          <IconButton icon="replay" label="重试" show-label variant="accent" @click="emit('retry')" />
        </div>
        <div v-else-if="threads.length === 0" class="panel__state">
          <VanIcon name="chat-o" />
          <span>还没有评论，写第一句</span>
        </div>

        <ThreadItem
          v-for="thread in threads"
          :key="thread.id"
          :thread="thread"
          @reply="(id, name) => emit('reply', id, name)"
          @mark="(id, mark, on) => emit('mark', id, mark, on)"
        />

        <IconButton
          v-if="failed && threads.length > 0"
          icon="replay"
          label="重试生成"
          show-label
          variant="accent"
          @click="emit('retry')"
        />

        <div class="panel__tools">
          <div v-if="batchCount > 1" class="panel__pager">
            <IconButton icon="arrow-left" label="上一批" :disabled="batchNo <= 1" @click="emit('batch', -1)" />
            <span>第 {{ batchNo }}/{{ batchCount }} 批</span>
            <IconButton icon="arrow" label="下一批" :disabled="batchNo >= batchCount" @click="emit('batch', 1)" />
          </div>
          <IconButton
            class="panel__reroll"
            icon="replay"
            :label="rerollsLeft > 0 ? `换一批（今天还剩 ${rerollsLeft} 次）` : '换一批（今天已用完）'"
            variant="muted"
            :disabled="rerollsLeft <= 0"
            @click="emit('reroll')"
          >
            <span class="panel__reroll-text">换一批 · {{ rerollsLeft }}</span>
          </IconButton>
          <IconButton icon="info-o" label="查背景" variant="muted" @click="emit('background')">
            <span class="panel__reroll-text">查背景</span>
          </IconButton>
          <IconButton icon="notes-o" label="深入聊聊" variant="muted" @click="emit('deep')">
            <span class="panel__reroll-text">深入聊聊</span>
          </IconButton>
        </div>
        <p v-if="rerollMessage" class="panel__note">{{ rerollMessage }}</p>
      </template>

      <div v-if="replying" class="panel__note panel__note--live">
        <VanLoading size="14px" />
        <span>书友正在接话</span>
      </div>
      <div v-if="replyFailed" class="panel__note">
        <VanIcon name="warning-o" />
        <span>书友没接上话</span>
        <IconButton icon="replay" label="重试" show-label variant="accent" @click="emit('retryReply')" />
      </div>
    </div>

    <form class="panel__composer" @submit.prevent="submit">
      <div v-if="replyTo || mention" class="panel__tags">
        <VanTag v-if="replyTo" closeable round type="primary" plain size="medium" @close="emit('cancelReply')">
          回复 {{ replyTo.name }}
        </VanTag>
        <VanTag v-if="mention" closeable round type="primary" plain size="medium" @close="mention = ''">
          @{{ mention }}
        </VanTag>
      </div>
      <div v-if="mentionsOpen" class="panel__mentions" role="listbox" aria-label="@ 书友">
        <button
          v-for="name in residents"
          :key="name"
          type="button"
          role="option"
          :aria-selected="mention === name"
          :class="{ 'is-on': mention === name }"
          @click="pickMention(name)"
        >
          {{ name }}
        </button>
      </div>
      <div class="panel__input">
        <IconButton
          v-if="residents.length > 0"
          icon="friends-o"
          label="@ 书友"
          :active="mentionsOpen"
          variant="muted"
          @click="mentionsOpen = !mentionsOpen"
        />
        <textarea v-model="draft" rows="1" placeholder="写一句段评" aria-label="段评内容" @input="grow" />
        <IconButton
          icon="guide-o"
          label="发送"
          variant="accent"
          type="submit"
          :disabled="!draft.trim()"
          class="panel__send"
        />
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Icon as VanIcon, Loading as VanLoading, Tag as VanTag } from 'vant'
import IconButton from '@/components/common/IconButton.vue'
import type { CommentMarks, ReaderThread } from '@/db/repos/comments'
import ThreadItem from './ThreadItem.vue'

const props = withDefaults(
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
  background: []
  deep: []
}>()

const draft = ref('')
const mention = ref('')
const mentionsOpen = ref(false)
const lift = ref(0)

const total = computed(() => props.threads.reduce((sum, thread) => sum + 1 + thread.replies.length, 0))

function pickMention(name: string) {
  mention.value = mention.value === name ? '' : name
  mentionsOpen.value = false
}

function grow(event: Event) {
  const el = event.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}

function submit(event: Event) {
  const text = draft.value.trim()
  if (!text) return
  emit('submit', { text, mention: mention.value })
  draft.value = ''
  mention.value = ''
  mentionsOpen.value = false
  const area = (event.target as HTMLFormElement).querySelector('textarea')
  if (area) area.style.height = ''
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
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  min-height: 100%;
  box-sizing: border-box;
  color: var(--rs-text, #1c1917);
}

.panel__head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--rs-space-2) var(--rs-space-2) var(--rs-space-2) var(--rs-space-4);
  border-bottom: 1px solid var(--rs-border);
  background: var(--rs-surface);
}

.panel__title {
  display: flex;
  align-items: baseline;
  gap: var(--rs-space-2);
  margin: 0;
  font-size: var(--rs-text-md);
  font-weight: 600;
}

.panel__count {
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);
  font-weight: 400;
}

.panel__body {
  flex: 1;
  padding: 0 var(--rs-space-4) var(--rs-space-3);
}

.panel__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--rs-space-2);
  padding: var(--rs-space-6) 0;
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);

  > .van-icon {
    font-size: 28px;
    opacity: 0.6;
  }
}

.panel__tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--rs-space-2);
  margin-top: var(--rs-space-2);
}

.panel__pager {
  display: flex;
  align-items: center;
  color: var(--rs-muted);
  font-size: var(--rs-text-xs);
  font-variant-numeric: tabular-nums;
}

.panel__reroll {
  margin-left: auto;
}

.panel__reroll-text {
  font-size: var(--rs-text-xs);
}

.panel__note {
  display: flex;
  align-items: center;
  gap: var(--rs-space-2);
  margin: var(--rs-space-2) 0 0;
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);
}

.panel__composer {
  position: sticky;
  bottom: 0;
  padding: var(--rs-space-2) var(--rs-space-3) var(--rs-space-3);
  border-top: 1px solid var(--rs-border);
  background: var(--rs-surface);
}

.panel__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-2);
  margin-bottom: var(--rs-space-2);
}

.panel__mentions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-2);
  margin-bottom: var(--rs-space-2);

  button {
    padding: 4px 12px;
    border: 1px solid var(--rs-border);
    border-radius: 999px;
    background: var(--rs-bg);
    color: var(--rs-text);
    font: inherit;
    font-size: var(--rs-text-sm);
    cursor: pointer;
  }

  .is-on {
    border-color: var(--rs-accent);
    color: var(--rs-accent);
  }
}

.panel__input {
  display: flex;
  align-items: flex-end;
  gap: var(--rs-space-1);

  textarea {
    flex: 1;
    min-width: 0;
    min-height: 40px;
    box-sizing: border-box;
    padding: 9px var(--rs-space-3);
    border: 1px solid var(--rs-border);
    border-radius: 20px;
    background: var(--rs-bg);
    color: inherit;
    font: inherit;
    font-size: var(--rs-text-md);
    line-height: 1.4;
    resize: none;
    outline: none;

    &:focus {
      border-color: var(--rs-accent);
    }
  }
}
</style>
