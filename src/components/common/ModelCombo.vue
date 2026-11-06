<template>
  <div ref="root" class="model-combo">
    <VanField
      :model-value="modelValue"
      label="模型名"
      :placeholder="placeholder"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open && visible.length > 0"
      @update:model-value="onInput"
      @focus="show"
      @blur="closeSoon"
    >
      <template #button>
        <button
          type="button"
          class="model-combo__refresh"
          :aria-label="loading ? '正在获取模型' : '获取模型'"
          :disabled="loading"
          @click="emit('refresh')"
        >
          <VanIcon name="replay" :class="{ 'is-spinning': loading }" />
        </button>
      </template>
    </VanField>
    <Teleport to="body">
      <ul v-if="open && visible.length" class="model-combo__list" role="listbox" :style="listStyle">
        <li v-for="item in visible" :key="item" role="option" @mousedown.prevent="pick(item)">{{ item }}</li>
      </ul>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Field as VanField, Icon as VanIcon } from 'vant'
import { filterModelIds } from '@/core/llm'

const props = withDefaults(
  defineProps<{
    modelValue: string
    options?: string[]
    placeholder?: string
    loading?: boolean
  }>(),
  { options: () => [], placeholder: 'deepseek-chat', loading: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string]; refresh: [] }>()

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const listStyle = ref<Record<string, string>>({})
let closeTimer = 0

const visible = computed(() => filterModelIds(props.options, props.modelValue))

function place() {
  const input = root.value?.querySelector('input')
  const box = input?.getBoundingClientRect()
  if (!box) return
  listStyle.value = {
    position: 'fixed',
    top: `${box.bottom + 4}px`,
    left: `${box.left}px`,
    width: `${box.width}px`,
    zIndex: '4000',
  }
}

function show() {
  open.value = true
  place()
}

function onInput(value: string) {
  open.value = true
  emit('update:modelValue', value)
  place()
}

function pick(value: string) {
  emit('update:modelValue', value)
  open.value = false
}

function closeSoon() {
  window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(() => {
    open.value = false
  }, 120)
}
</script>

<style scoped lang="less">
.model-combo__refresh {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rs-accent);

  &:disabled {
    opacity: 0.6;
  }

  .is-spinning {
    animation: model-combo-spin 0.8s linear infinite;
  }
}

@keyframes model-combo-spin {
  to {
    transform: rotate(-360deg);
  }
}

.model-combo__list {
  max-height: 240px;
  margin: 0;
  padding: var(--rs-space-1) 0;
  overflow: auto;
  list-style: none;
  background: var(--rs-surface);
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-md);
  box-shadow: var(--rs-shadow-card);

  li {
    padding: var(--rs-space-2) var(--rs-space-3);
    font-size: var(--rs-text-sm);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
}
</style>
