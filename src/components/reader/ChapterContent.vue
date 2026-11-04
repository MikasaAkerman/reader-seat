<template>
  <!-- 段落 html 在导入时已经过 DOMPurify -->
  <!-- eslint-disable vue/no-v-html -->
  <article class="chapter">
    <h1 class="chapter__title">{{ title }}</h1>
    <div
      v-for="paragraph in paragraphs"
      :key="paragraph.id"
      class="chapter__p"
      :class="{ 'chapter__p--heading': paragraph.kind === 'heading' }"
      :data-order="paragraph.order"
      v-html="paragraph.html"
    />
  </article>
</template>

<script setup lang="ts">
import type { ParagraphKind } from '@/db/schema'

defineProps<{
  title: string
  paragraphs: { id: string; order: number; kind: ParagraphKind; html: string }[]
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
</style>
