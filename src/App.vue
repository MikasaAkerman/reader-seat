<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'

onMounted(() => {
  void useSettingsStore().loadDisplay()
})
</script>

<style>
html,
body,
#app {
  margin: 0;
  min-height: 100%;
  font-family:
    'PingFang SC',
    'Hiragino Sans GB',
    'Noto Sans SC',
    system-ui,
    -apple-system,
    sans-serif;
  background: var(--rs-bg, #f7f4ef);
  color: var(--rs-text, #1c1917);
}
</style>
