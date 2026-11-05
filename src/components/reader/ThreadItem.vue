<template>
  <article class="thread">
    <div class="thread__main">
      <span class="thread__avatar" :class="`thread__avatar--${thread.authorType}`" aria-hidden="true">
        {{ thread.displayName.slice(0, 1) }}
      </span>
      <div class="thread__content">
        <header class="thread__meta">
          <strong>{{ thread.displayName }}</strong>
          <span v-if="kindBadge" class="thread__badge">{{ kindBadge }}</span>
          <span v-else-if="badge(thread.authorType)" class="thread__badge">{{ badge(thread.authorType) }}</span>
        </header>
        <h3 v-if="thread.title" class="thread__title">{{ thread.title }}</h3>
        <p class="thread__text" :class="{ 'thread__text--fold': foldable && !expandedBody }">{{ thread.text }}</p>
        <button v-if="foldable" type="button" class="thread__more" @click="expandedBody = !expandedBody">
          {{ expandedBody ? '收起' : '展开全文' }}
        </button>
        <blockquote v-for="(item, index) in thread.evidence ?? []" :key="index" class="thread__quote">
          {{ item.quote }}
        </blockquote>
        <details v-if="thread.background" class="thread__background">
          <summary>背景知识，未核实</summary>
          <p>{{ thread.background }}</p>
        </details>
        <p v-if="thread.question" class="thread__question">问一句：{{ thread.question }}</p>
        <div class="thread__actions">
          <span v-if="flagged(thread.marks)" class="thread__flag">已标{{ flagged(thread.marks) }}</span>
          <IconButton icon="chat-o" label="回复" variant="muted" @click="emit('reply', thread.id, thread.displayName)" />
          <IconButton
            :icon="thread.marks.saved ? 'star' : 'star-o'"
            :label="thread.marks.saved ? '取消收藏' : '收藏'"
            :variant="thread.marks.saved ? 'accent' : 'muted'"
            :active="thread.marks.saved"
            @click="emit('mark', thread.id, 'saved', !thread.marks.saved)"
          />
          <IconButton icon="ellipsis" label="更多标记" variant="muted" @click="openMarks(thread)" />
        </div>

        <div v-if="shown.length > 0" class="thread__replies">
          <div v-for="reply in shown" :key="reply.id" class="thread__reply">
            <header class="thread__meta">
              <strong>{{ reply.displayName }}</strong>
              <span v-if="badge(reply.authorType)" class="thread__badge">{{ badge(reply.authorType) }}</span>
            </header>
            <p class="thread__text">{{ reply.text }}</p>
            <div class="thread__actions">
              <span v-if="flagged(reply.marks)" class="thread__flag">已标{{ flagged(reply.marks) }}</span>
              <IconButton
                icon="chat-o"
                label="回复"
                variant="muted"
                @click="emit('reply', reply.id, reply.displayName)"
              />
              <IconButton
                :icon="reply.marks.saved ? 'star' : 'star-o'"
                :label="reply.marks.saved ? '取消收藏' : '收藏'"
                :variant="reply.marks.saved ? 'accent' : 'muted'"
                :active="reply.marks.saved"
                @click="emit('mark', reply.id, 'saved', !reply.marks.saved)"
              />
              <IconButton icon="ellipsis" label="更多标记" variant="muted" @click="openMarks(reply)" />
            </div>
          </div>
          <button v-if="hidden > 0 && !expanded" type="button" class="thread__more" @click="expanded = true">
            展开 {{ hidden }} 条回复
          </button>
        </div>
      </div>
    </div>

    <VanActionSheet
      v-model:show="marksOpen"
      :actions="markActions"
      cancel-text="取消"
      close-on-click-action
      teleport="body"
      @select="onMark"
    />
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ActionSheet as VanActionSheet, type ActionSheetAction } from 'vant'
import IconButton from '@/components/common/IconButton.vue'
import type { AuthorType } from '@/core/types'
import type { CommentMarks, ReaderThread } from '@/db/repos/comments'

type Marked = { id: string; marks: CommentMarks }
type FlagKey = Exclude<keyof CommentMarks, 'saved'>

const props = defineProps<{
  thread: ReaderThread
}>()

const emit = defineEmits<{
  reply: [id: string, name: string]
  mark: [id: string, mark: keyof CommentMarks, on: boolean]
}>()

const FLAGS: { id: FlagKey; label: string }[] = [
  { id: 'boring', label: '无聊' },
  { id: 'spoiler', label: '剧透' },
  { id: 'wrong', label: '错误' },
]

const expanded = ref(false)
const expandedBody = ref(false)
const foldable = computed(() => props.thread.kind === 'deep' && props.thread.text.length > 160)
const kindBadge = computed(() => {
  if (props.thread.kind === 'deep') return '长评'
  if (props.thread.kind === 'background') return '背景知识，未核实'
  return ''
})
const marksOpen = ref(false)
const target = ref<Marked | null>(null)
const shown = computed(() => (expanded.value ? props.thread.replies : props.thread.replies.slice(0, 2)))
const hidden = computed(() => Math.max(0, props.thread.replies.length - 2))
const markActions = computed<ActionSheetAction[]>(() =>
  FLAGS.map((flag) => {
    const on = target.value?.marks[flag.id] === true
    return { name: on ? `取消「${flag.label}」` : `标为${flag.label}`, color: on ? 'var(--rs-accent)' : undefined }
  }),
)

function badge(authorType: AuthorType): string {
  if (authorType === 'user') return ''
  if (authorType === 'resident') return '常驻'
  return 'AI'
}

function flagged(marks: CommentMarks): string {
  const labels = FLAGS.filter((flag) => marks[flag.id]).map((flag) => flag.label)
  return labels.length > 0 ? `「${labels.join('、')}」` : ''
}

function openMarks(item: Marked) {
  target.value = item
  marksOpen.value = true
}

function onMark(_action: ActionSheetAction, index: number) {
  const item = target.value
  const flag = FLAGS[index]
  if (!item || !flag) return
  emit('mark', item.id, flag.id, !item.marks[flag.id])
}
</script>

<style scoped lang="less">
.thread {
  padding: var(--rs-space-4) 0 var(--rs-space-1);
  border-bottom: 1px solid var(--rs-border, #e7e5e4);

  &:last-of-type {
    border-bottom: 0;
  }
}

.thread__main {
  display: flex;
  gap: var(--rs-space-3);
}

.thread__avatar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: var(--rs-surface-2);
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);
  font-weight: 600;
}

.thread__avatar--resident {
  background: var(--rs-accent-soft);
  color: var(--rs-accent);
}

.thread__avatar--user {
  background: var(--rs-accent);
  color: var(--rs-on-accent);
}

.thread__content {
  flex: 1;
  min-width: 0;
}

.thread__meta {
  display: flex;
  align-items: center;
  gap: var(--rs-space-2);
  min-height: 20px;

  strong {
    font-size: var(--rs-text-sm);
    font-weight: 600;
  }
}

.thread__badge {
  padding: 0 5px;
  border-radius: 4px;
  background: var(--rs-surface-2);
  color: var(--rs-muted);
  font-size: 10px;
  line-height: 16px;
}

.thread__title {
  margin: var(--rs-space-1) 0 0;
  font-size: var(--rs-text-sm);
  font-weight: 600;
}

.thread__text {
  margin: var(--rs-space-1) 0 0;
  font-size: var(--rs-text-md);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.thread__text--fold {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  overflow: hidden;
}

.thread__quote {
  margin: var(--rs-space-2) 0 0;
  padding: 0 0 0 var(--rs-space-3);
  border-left: 2px solid var(--rs-accent-soft, #ccfbf1);
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);
}

.thread__background {
  margin: var(--rs-space-2) 0 0;
  padding: var(--rs-space-2);
  border-radius: 8px;
  background: var(--rs-surface-2);
  color: var(--rs-muted);
  font-size: var(--rs-text-xs);

  summary {
    cursor: pointer;
  }

  p {
    margin: var(--rs-space-1) 0 0;
    line-height: 1.6;
  }
}

.thread__question {
  margin: var(--rs-space-2) 0 0;
  color: var(--rs-accent);
  font-size: var(--rs-text-sm);
}

.thread__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin: -6px calc(-1 * var(--rs-space-2)) 0 0;

  :deep(.icon-button) {
    min-width: 36px;
    min-height: 36px;
  }

  :deep(.icon-button__icon) {
    font-size: 16px;
  }
}

.thread__flag {
  margin-right: auto;
  color: var(--rs-muted);
  font-size: var(--rs-text-xs);
}

.thread__replies {
  margin: var(--rs-space-1) 0 var(--rs-space-2);
  padding-left: var(--rs-space-3);
  border-left: 2px solid var(--rs-border);
}

.thread__reply + .thread__reply {
  margin-top: var(--rs-space-2);
}

.thread__more {
  padding: var(--rs-space-1) 0;
  border: 0;
  background: transparent;
  color: var(--rs-accent);
  font: inherit;
  font-size: var(--rs-text-xs);
  cursor: pointer;
}
</style>
