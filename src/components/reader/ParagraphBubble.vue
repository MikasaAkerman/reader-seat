<template>
  <button
    class="bubble"
    :class="{ 'bubble--hot': hot && !pending, 'bubble--pending': pending, 'bubble--locked': locked, 'bubble--deep': deep && !pending }"
    type="button"
    :aria-label="pending ? '书友正在写' : locked ? `段评 ${count}，先写后看` : `段评 ${count}`"
    @click="emit('open')"
  >
    <VanLoading v-if="pending" size="12px" color="currentColor" />
    <VanIcon v-else :name="locked ? 'lock' : 'chat-o'" />
    <span v-if="!pending">{{ count }}</span>
    <span v-if="deep && !pending" class="bubble__deep">深</span>
  </button>
</template>

<script setup lang="ts">
import { Icon as VanIcon, Loading as VanLoading } from 'vant'

defineProps<{
  count: number
  hot: boolean
  pending: boolean
  locked?: boolean
  deep?: boolean
}>()

const emit = defineEmits<{
  open: []
}>()
</script>

<style scoped lang="less">
.bubble {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  margin: -0.4em 0 1em;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: var(--rs-accent-soft);
  color: var(--rs-accent, #0f766e);
  font-family: var(--rs-font-ui);
  font-size: var(--rs-text-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  cursor: pointer;

  .van-icon {
    font-size: 13px;
  }
}

.bubble--hot {
  background: var(--rs-accent, #0f766e);
  color: var(--rs-on-accent);
  font-weight: 600;
}

.bubble--pending {
  min-width: 34px;
  justify-content: center;
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--rs-border);
  color: var(--rs-muted, #78716c);
}

.bubble--locked {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--rs-border);
  color: var(--rs-muted, #78716c);
}

.bubble__deep {
  font-weight: 700;
}
</style>
