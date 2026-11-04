<template>
  <div class="setup">
    <VanNavBar title="开书设置" left-arrow @click-left="goLibrary" />
    <p v-if="missing" class="setup__hint">找不到这本书。</p>
    <form v-else class="setup__form" @submit.prevent="save">
      <h1>{{ title }}</h1>
      <fieldset>
        <legend>常驻书友</legend>
        <label v-for="persona in lineup" :key="persona.role" class="setup__row">
          <span>{{ persona.displayName }} · {{ persona.role }}</span>
          <VanSwitch
            :model-value="enabled[persona.role] !== false"
            @update:model-value="setEnabled(persona.role, $event)"
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>防剧透</legend>
        <VanRadioGroup :model-value="spoilerLevel" @update:model-value="setSpoiler">
          <VanRadio name="严格">严格</VanRadio>
          <VanRadio name="可暗示">可暗示</VanRadio>
          <VanRadio name="全开放">全开放</VanRadio>
        </VanRadioGroup>
      </fieldset>
      <fieldset>
        <legend>先写后看</legend>
        <p class="setup__note">先写后看会在后面的版本锁住评论，这一版只保存选择。</p>
        <VanRadioGroup :model-value="unlockMode" @update:model-value="setUnlock">
          <VanRadio name="关闭">关闭</VanRadio>
          <VanRadio name="逐段先写后看">逐段先写后看</VanRadio>
          <VanRadio name="章末解锁">章末解锁</VanRadio>
        </VanRadioGroup>
      </fieldset>
      <label class="setup__station">
        阅读计划站点
        <select :value="station" @change="onStation">
          <option :value="0">不加入</option>
          <option v-for="item in stations" :key="item.id" :value="item.id">
            {{ item.id }}｜{{ item.name }}
          </option>
        </select>
      </label>
      <VanButton block round type="primary" native-type="submit">保存并开始读</VanButton>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Button as VanButton,
  NavBar as VanNavBar,
  Radio as VanRadio,
  RadioGroup as VanRadioGroup,
  Switch as VanSwitch,
  showToast,
} from 'vant'
import { READING_STATIONS } from '@/core/stations'
import { DEFAULT_LINEUP } from '@/core/personas'
import type { SpoilerLevel, UnlockMode } from '@/core/types'
import { getBook, updateBookSettings } from '@/db/repos/library'

const route = useRoute()
const router = useRouter()
const stations = READING_STATIONS
const lineup = DEFAULT_LINEUP
const title = ref('')
const missing = ref(false)
const spoilerLevel = ref<SpoilerLevel>('严格')
const unlockMode = ref<UnlockMode>('关闭')
const station = ref(0)
const enabled = reactive<Record<string, boolean>>({})

onMounted(async () => {
  const book = await getBook(String(route.params.bookId))
  if (!book) {
    missing.value = true
    return
  }
  title.value = book.title
  spoilerLevel.value = book.spoilerLevel
  unlockMode.value = book.unlockMode
  station.value = book.station ?? 0
  for (const persona of lineup) enabled[persona.role] = book.lineup[persona.role] !== false
})

function setEnabled(role: string, value: boolean) {
  enabled[role] = value
}

function setSpoiler(value: string | number) {
  if (value === '严格' || value === '可暗示' || value === '全开放') spoilerLevel.value = value
}

function setUnlock(value: string | number) {
  if (value === '关闭' || value === '逐段先写后看' || value === '章末解锁') unlockMode.value = value
}

function onStation(event: Event) {
  station.value = Number((event.target as HTMLSelectElement).value)
}

async function save() {
  const bookId = String(route.params.bookId)
  try {
    await updateBookSettings(bookId, {
      spoilerLevel: spoilerLevel.value,
      unlockMode: unlockMode.value,
      station: station.value || null,
      lineup: { ...enabled },
    })
  } catch (err) {
    showToast(err instanceof Error ? err.message : '保存失败')
    return
  }
  await router.push({ name: 'reader', params: { bookId } })
}

function goLibrary() {
  void router.push({ name: 'library' })
}
</script>

<style scoped lang="less">
.setup {
  min-height: 100vh;
  background: var(--rs-bg);
}

.setup__form {
  max-width: 560px;
  margin: 0 auto;
  padding: 20px 20px 40px;

  h1 {
    margin: 0 0 16px;
    font-size: 24px;
  }

  fieldset {
    border: 1px solid var(--rs-border);
    border-radius: 12px;
    margin: 0 0 16px;
    padding: 12px 16px 16px;
  }

  legend {
    padding: 0 6px;
  }
}

.setup__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.setup__note,
.setup__hint {
  color: var(--rs-muted);
  font-size: 13px;
  line-height: 1.5;
}

.setup__station {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;

  select {
    height: 40px;
    border-radius: 8px;
    border: 1px solid var(--rs-border);
    background: var(--rs-surface);
    color: inherit;
    padding: 0 8px;
  }
}

:deep(.van-radio) {
  margin: 8px 0;
}
</style>
