<template>
  <button
    class="icon-button"
    :class="[
      `icon-button--${variant}`,
      { 'icon-button--labeled': label && showLabel, 'icon-button--active': active, 'icon-button--loading': loading },
    ]"
    :type="type"
    :aria-label="label"
    :aria-pressed="active === undefined ? undefined : active"
    :title="label"
    :disabled="disabled"
    :aria-busy="loading || undefined"
  >
    <VanLoading v-if="loading" size="16px" />
    <VanIcon v-else :name="icon" class="icon-button__icon" />
    <span v-if="label && showLabel" class="icon-button__label">{{ label }}</span>
    <slot />
  </button>
</template>

<script setup lang="ts">
import { Icon as VanIcon, Loading as VanLoading } from 'vant'

withDefaults(
  defineProps<{
    icon: string
    label: string
    showLabel?: boolean
    variant?: 'default' | 'accent' | 'danger' | 'muted'
    active?: boolean
    disabled?: boolean
    loading?: boolean
    type?: 'button' | 'submit'
  }>(),
  { showLabel: false, variant: 'default', active: undefined, disabled: false, loading: false, type: 'button' },
)
</script>

<style scoped lang="less">
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-1);
  min-width: 40px;
  min-height: 40px;
  padding: 0 var(--rs-space-2);
  border: 0;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-text);
  font: inherit;
  font-size: var(--rs-text-sm);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:hover:not(:disabled),
  &:active:not(:disabled) {
    background: var(--rs-accent-soft);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }

  &--loading {
    color: var(--rs-accent);
    pointer-events: none;
  }
}

.icon-button__icon {
  font-size: 20px;
}

.icon-button--labeled .icon-button__icon {
  font-size: 17px;
}

.icon-button--accent,
.icon-button--active {
  color: var(--rs-accent);
}

.icon-button--danger {
  color: var(--rs-danger);
}

.icon-button--muted {
  color: var(--rs-muted);
}
</style>
