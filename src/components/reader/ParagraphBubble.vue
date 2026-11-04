<template>
  <button
    class="bubble"
    :class="{ 'bubble--hot': hot, 'bubble--pending': pending, 'bubble--locked': locked }"
    type="button"
    :aria-label="pending ? '书友正在写' : locked ? `段评 ${count}，先写后看` : `段评 ${count}`"
    @click="emit('open')"
  >
    {{ pending ? '…' : locked ? `${count} 锁` : count }}
  </button>
</template>

<script setup lang="ts">
defineProps<{
  count: number
  hot: boolean
  pending: boolean
  locked?: boolean
}>()

const emit = defineEmits<{
  open: []
}>()
</script>

<style scoped lang="less">
.bubble {
  margin: -0.4em 0 1em;
  border: 0;
  border-radius: 999px;
  padding: 2px 10px;
  background: var(--rs-surface, #fff);
  color: var(--rs-accent, #0f766e);
  font-size: 13px;
  box-shadow: inset 0 0 0 1px var(--rs-border, #e7e5e4);
}

.bubble--hot {
  background: var(--rs-accent, #0f766e);
  color: white;
  font-weight: 700;
}

.bubble--pending {
  color: var(--rs-muted, #78716c);
}
</style>
