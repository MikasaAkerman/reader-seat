<template>
  <div class="comment">
    <div class="comment__meta">
      <strong>{{ comment.displayName }}</strong>
      <span class="comment__ai">AI 书友</span>
      <span v-if="comment.replyType" class="comment__type">{{ comment.replyType }}</span>
    </div>
    <p class="comment__text">{{ comment.text }}</p>
    <div class="comment__marks">
      <button
        v-for="flag in flags"
        :key="flag"
        type="button"
        class="comment__flag"
        :class="{ 'comment__flag--on': mark === flag }"
        @click="emit('mark', comment.id, flag)"
      >
        {{ flag }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Phase0Reply } from '@/core/generation/phase0'

const flags = ['有趣', '无聊', '剧透', '错误'] as const
type Mark = (typeof flags)[number]

defineProps<{
  comment: Phase0Reply & { replies?: unknown }
  mark?: Mark
}>()

const emit = defineEmits<{
  mark: [id: string, mark: Mark]
}>()
</script>

<style scoped lang="less">
.comment__meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
}

.comment__ai {
  font-size: 12px;
  color: var(--rs-accent);
  border: 1px solid var(--rs-accent);
  border-radius: 999px;
  padding: 0 6px;
}

.comment__type {
  color: var(--rs-muted);
  font-size: 12px;
}

.comment__text {
  margin: 6px 0;
  line-height: 1.6;
}

.comment__marks {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.comment__flag {
  border: 1px solid var(--rs-border);
  background: transparent;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
}

.comment__flag--on {
  background: #ccfbf1;
  border-color: #0f766e;
}
</style>
