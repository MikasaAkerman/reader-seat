<template>
  <div class="home">
    <header class="home__header">
      <h1>书友席</h1>
      <p>陪你读到这一页的书友评论区</p>
    </header>
    <VanButton type="primary" block round @click="goSettings">打开设置</VanButton>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Button as VanButton } from 'vant'

const router = useRouter()

function goSettings() {
  void router.push({ name: 'settings' })
}
</script>

<style scoped lang="less">
.home {
  max-width: 480px;
  margin: 0 auto;
  padding: 48px 24px;
}

.home__header {
  margin-bottom: 32px;

  h1 {
    margin: 0 0 8px;
    font-size: 32px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  p {
    margin: 0;
    color: var(--rs-muted);
  }
}
</style>
