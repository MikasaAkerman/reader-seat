<template>
  <div class="info-tip">
    <div class="info-tip__row">
      <span v-if="$slots.default" class="info-tip__title"><slot /></span>
      <button
        class="info-tip__toggle"
        :class="{ 'info-tip__toggle--open': open }"
        type="button"
        :aria-label="open ? '收起说明' : label"
        :aria-expanded="open"
        :aria-controls="id"
        @click.stop="open = !open"
      >
        <VanIcon name="question-o" />
      </button>
    </div>
    <Transition name="info-tip">
      <div v-if="open" :id="id" class="info-tip__body" role="note">
        <slot name="body">{{ text }}</slot>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue'
import { Icon as VanIcon } from 'vant'

withDefaults(defineProps<{ text?: string; label?: string }>(), {
  text: '',
  label: '查看说明',
})

const open = ref(false)
const id = `info-tip-${useId()}`
</script>

<style scoped lang="less">
.info-tip {
  min-width: 0;
}

.info-tip__row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.info-tip__title {
  min-width: 0;
}

.info-tip__toggle {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: -4px 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--rs-muted);
  font-size: 15px;
  cursor: pointer;

  &:hover,
  &--open {
    color: var(--rs-accent);
  }
}

.info-tip__body {
  margin-top: var(--rs-space-2);
  padding: var(--rs-space-2) var(--rs-space-3);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-accent-soft);
  color: var(--rs-text);
  font-size: var(--rs-text-sm);
  font-weight: 400;
  line-height: 1.6;
  text-align: left;
  white-space: normal;
}

.info-tip-enter-active,
.info-tip-leave-active {
  transition: opacity 0.15s ease;
}

.info-tip-enter-from,
.info-tip-leave-to {
  opacity: 0;
}
</style>
