<template>
  <!-- 段落 html 在导入时已经过 DOMPurify -->
  <!-- eslint-disable vue/no-v-html -->
  <article class="chapter" @click="onClick">
    <h1 v-if="title && !titleRepeated" class="chapter__title">{{ title }}</h1>
    <div
      v-for="paragraph in paragraphs"
      :key="paragraph.id"
      class="chapter__block"
      :data-paragraph-id="paragraph.id"
      @pointerdown="onPointerDown(paragraph, $event)"
      @pointerup="onPointerUp"
      @pointercancel="cancelPress"
    >
      <div
        class="chapter__p"
        :class="{ 'chapter__p--heading': paragraph.kind === 'heading' }"
        :data-order="paragraph.order"
        v-html="paragraph.html"
      />
      <template v-if="!commentsHidden">
        <ParagraphBubble
          v-if="bubbles[paragraph.id] && !bubbles[paragraph.id]?.failed"
          :count="bubbles[paragraph.id]?.count ?? 0"
          :hot="bubbles[paragraph.id]?.hot ?? false"
          :pending="bubbles[paragraph.id]?.pending ?? false"
          :locked="bubbles[paragraph.id]?.locked ?? false"
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
        <button v-else class="chapter__write" type="button" @click="emit('open', paragraph.id)">段评</button>
      </template>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { BubbleState } from '@/db/repos/comments'
import type { ParagraphKind } from '@/db/schema'
import ParagraphBubble from './ParagraphBubble.vue'

const props = defineProps<{
  title: string
  commentsHidden?: boolean
  paragraphs: { id: string; order: number; kind: ParagraphKind; html: string; text: string }[]
  bubbles: Record<string, BubbleState>
}>()

let pressTimer = 0

function cancelPress() {
  window.clearTimeout(pressTimer)
  pressTimer = 0
}

function onPointerDown(
  paragraph: { id: string; kind: ParagraphKind },
  event: PointerEvent,
) {
  cancelPress()
  if (props.commentsHidden || paragraph.kind === 'heading') return
  if (event.target instanceof Element && event.target.closest('button')) return
  pressTimer = window.setTimeout(() => emit('interesting', paragraph.id), 600)
}

/** 书里的链接一律不让 webview 自己跳转，交给阅读页处理。 */
function onClick(event: MouseEvent) {
  if (!(event.target instanceof Element)) return
  const link = event.target.closest('a')
  if (!link || !link.closest('.chapter__p')) return
  event.preventDefault()
  const href = link.getAttribute('href')
  if (href) emit('link', href)
}

function onPointerUp() {
  cancelPress()
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return
  const quote = selection.toString().replace(/\s+/g, '')
  if (!quote) return
  const anchor = selection.anchorNode?.parentElement?.closest('[data-paragraph-id]')
  const focus = selection.focusNode?.parentElement?.closest('[data-paragraph-id]')
  if (!anchor || anchor !== focus) return
  const paragraphId = anchor.getAttribute('data-paragraph-id') ?? ''
  const paragraph = props.paragraphs.find((item) => item.id === paragraphId)
  if (!paragraph) return
  const start = paragraph.text.replace(/\s+/g, '').indexOf(quote)
  if (start < 0) return
  emit('highlight', { paragraphId, quote, start, end: start + quote.length })
  selection.removeAllRanges()
}

const titleRepeated = computed(() => {
  const first = props.paragraphs[0]
  if (!first || first.kind !== 'heading') return false
  return compact(first.text) === compact(props.title)
})

function compact(value: string): string {
  return value.replace(/\s+/g, '')
}

const emit = defineEmits<{
  open: [id: string]
  interesting: [id: string]
  highlight: [payload: { paragraphId: string; quote: string; start: number; end: number }]
  link: [href: string]
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

.chapter__retry,
.chapter__write {
  margin: -0.4em 0 1em;
  border: 0;
  background: transparent;
  color: var(--rs-muted, #78716c);
  padding: 0;
}
</style>
