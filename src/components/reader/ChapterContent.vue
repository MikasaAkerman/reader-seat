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
          class="chapter__action chapter__action--failed"
          type="button"
          aria-label="这段没生成出来，点开重试"
          title="生成失败"
          @click="emit('open', paragraph.id)"
        >
          <VanIcon name="replay" />
        </button>
        <button
          v-else
          class="chapter__action"
          type="button"
          aria-label="写段评"
          title="写段评"
          @click="emit('open', paragraph.id)"
        >
          <VanIcon name="chat-o" />
        </button>
      </template>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon as VanIcon } from 'vant'
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
.chapter {
  font-family: var(--rs-font-reading);
}

.chapter__title {
  margin: var(--rs-space-3) 0 var(--rs-space-6);
  font-size: calc(var(--rs-font-size, 18px) * 1.45);
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.02em;
  text-align: center;
}

.chapter__block {
  position: relative;
}

.chapter__p {
  margin: 0 0 1em;
  font-size: var(--rs-font-size, 18px);
  line-height: var(--rs-line-height, 1.85);
  text-align: justify;
  content-visibility: auto;
  contain-intrinsic-size: auto 4.5em;

  :deep(img) {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0.4em auto;
  }

  :deep(a) {
    color: var(--rs-accent);
    text-decoration: none;
  }
}

.chapter__p--heading {
  margin: 1.2em 0 0.8em;
  font-size: calc(var(--rs-font-size, 18px) * 1.2);
  font-weight: 600;
  line-height: 1.5;
}

.chapter__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 24px;
  margin: -0.5em 0 0.8em -6px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--rs-muted, #78716c);
  font-size: 15px;
  opacity: 0.4;
  cursor: pointer;
  transition: opacity 0.15s ease;

  &:hover,
  &:focus-visible {
    opacity: 1;
  }
}

.chapter__action--failed {
  color: var(--rs-danger);
  opacity: 0.85;
}
</style>
