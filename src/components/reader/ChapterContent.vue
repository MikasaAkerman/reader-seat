<template>
  <!-- 段落 html 在导入时已经过 DOMPurify -->
  <!-- eslint-disable vue/no-v-html -->
  <article class="chapter">
    <h1 class="chapter__title">{{ title }}</h1>
    <div v-for="paragraph in paragraphs" :key="paragraph.id" class="chapter__block">
      <div
        class="chapter__p"
        :class="{ 'chapter__p--heading': paragraph.kind === 'heading' }"
        :data-order="paragraph.order"
        v-html="paragraph.html"
      />
      <ParagraphBubble
        v-if="bubbles[paragraph.id] && !bubbles[paragraph.id]?.failed"
        :count="bubbles[paragraph.id]?.count ?? 0"
        :hot="bubbles[paragraph.id]?.hot ?? false"
        :pending="bubbles[paragraph.id]?.pending ?? false"
        @open="emit('open', paragraph.id)"
      />
      <button
        v-else-if="bubbles[paragraph.id]?.failed"
        class="chapter__retry"
        type="button"
        @click="emit('open', paragraph.id)"
      >
        生成失败
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import type { BubbleState } from '@/db/repos/comments'
import type { ParagraphKind } from '@/db/schema'
import ParagraphBubble from './ParagraphBubble.vue'

defineProps<{
  title: string
  paragraphs: { id: string; order: number; kind: ParagraphKind; html: string }[]
  bubbles: Record<string, BubbleState>
}>()

const emit = defineEmits<{
  open: [id: string]
}>()
</script>

<style scoped lang="less">
.chapter__title {
  margin: 0 0 24px;
  font-size: 1.4em;
  line-height: 1.4;
}

.chapter__p {
  margin: 0 0 1em;
  font-size: var(--rs-font-size, 18px);
  line-height: var(--rs-line-height, 1.85);
  content-visibility: auto;
  contain-intrinsic-size: auto 4.5em;

  :deep(img) {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0.4em 0;
  }
}

.chapter__p--heading {
  font-size: calc(var(--rs-font-size, 18px) * 1.25);
  font-weight: 700;
}

.chapter__retry {
  margin: -0.4em 0 1em;
  border: 0;
  background: transparent;
  color: var(--rs-muted, #78716c);
  padding: 0;
}
</style>
