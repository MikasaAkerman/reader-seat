<template>
  <div class="setup">
    <VanNavBar title="开书设置" left-arrow @click-left="goLibrary" />
    <VanEmpty v-if="missing" description="找不到这本书" />
    <form v-else class="setup__form" @submit.prevent="save">
      <h1 class="setup__title">{{ title }}</h1>

      <VanCellGroup inset title="常驻书友">
        <VanCell v-for="persona in lineup" :key="persona.role">
          <template #title>
            <InfoTip :text="persona.focus" :label="`${persona.displayName}关注什么`">
              <span class="setup__persona">{{ persona.displayName }}</span>
              <span class="setup__role">{{ persona.role }}</span>
            </InfoTip>
          </template>
          <template #right-icon>
            <VanSwitch
              size="20px"
              :model-value="enabled[persona.role] !== false"
              :aria-label="`${persona.displayName}参与评论`"
              @update:model-value="setEnabled(persona.role, $event)"
            />
          </template>
        </VanCell>
      </VanCellGroup>

      <VanRadioGroup :model-value="spoilerLevel" @update:model-value="setSpoiler">
        <VanCellGroup inset>
          <template #title>
            <InfoTip>
              防剧透
              <template #body>
                严格：只谈已读到的内容，老书虫不出场。可暗示：可以说某处重要，但不暗示方向。全开放：不限制。
              </template>
            </InfoTip>
          </template>
          <VanCell v-for="item in spoilerOptions" :key="item" :title="item" clickable @click="setSpoiler(item)">
            <template #right-icon><VanRadio :name="item" /></template>
          </VanCell>
        </VanCellGroup>
      </VanRadioGroup>

      <VanRadioGroup :model-value="unlockMode" @update:model-value="setUnlock">
        <VanCellGroup inset>
          <template #title>
            <InfoTip text="逐段：先写下看法才看这段评论。章末：读完并写微评，才解锁这一章的段评和本章说。">
              先写后看
            </InfoTip>
          </template>
          <VanCell v-for="item in unlockOptions" :key="item" :title="item" clickable @click="setUnlock(item)">
            <template #right-icon><VanRadio :name="item" /></template>
          </VanCell>
        </VanCellGroup>
      </VanRadioGroup>

      <VanCellGroup inset>
        <template #title>
          <InfoTip text="读到章末时，微评输入框默认展开还是收起。阅读中随时可以再打开或关闭。">本章微评</InfoTip>
        </template>
        <VanCell title="默认展开" center>
          <template #right-icon>
            <VanSwitch size="20px" :model-value="microOpen" aria-label="微评默认展开" @update:model-value="microOpen = $event" />
          </template>
        </VanCell>
      </VanCellGroup>

      <VanCellGroup inset title="阅读计划">
        <VanCell title="站点" :value="stationLabel" is-link @click="pickerOpen = true" />
      </VanCellGroup>

      <div class="setup__footer">
        <VanButton block round type="primary" native-type="submit">保存并开始读</VanButton>
      </div>
    </form>

    <VanPopup v-model:show="pickerOpen" position="bottom" round>
      <VanPicker
        title="阅读计划站点"
        :columns="stationColumns"
        :model-value="[station]"
        @confirm="onStation"
        @cancel="pickerOpen = false"
      />
    </VanPopup>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Button as VanButton,
  Cell as VanCell,
  CellGroup as VanCellGroup,
  Empty as VanEmpty,
  NavBar as VanNavBar,
  Picker as VanPicker,
  Popup as VanPopup,
  Radio as VanRadio,
  RadioGroup as VanRadioGroup,
  Switch as VanSwitch,
  showToast,
  type PickerConfirmEventParams,
} from 'vant'
import InfoTip from '@/components/common/InfoTip.vue'
import { READING_STATIONS } from '@/core/stations'
import { DEFAULT_LINEUP } from '@/core/personas'
import type { SpoilerLevel, UnlockMode } from '@/core/types'
import { getBook, updateBookSettings } from '@/db/repos/library'

const route = useRoute()
const router = useRouter()
const lineup = DEFAULT_LINEUP
const spoilerOptions: SpoilerLevel[] = ['严格', '可暗示', '全开放']
const unlockOptions: UnlockMode[] = ['关闭', '逐段先写后看', '章末解锁']
const stationColumns = [
  { text: '不加入', value: 0 },
  ...READING_STATIONS.map((item) => ({ text: `${item.id}｜${item.name}`, value: item.id })),
]
const title = ref('')
const missing = ref(false)
const spoilerLevel = ref<SpoilerLevel>('严格')
const unlockMode = ref<UnlockMode>('关闭')
const microOpen = ref(true)
const station = ref(0)
const pickerOpen = ref(false)
const enabled = reactive<Record<string, boolean>>({})

const stationLabel = computed(() => stationColumns.find((item) => item.value === station.value)?.text ?? '不加入')

onMounted(async () => {
  const book = await getBook(String(route.params.bookId))
  if (!book) {
    missing.value = true
    return
  }
  title.value = book.title
  spoilerLevel.value = book.spoilerLevel
  unlockMode.value = book.unlockMode
  microOpen.value = book.microReviewOpen !== false
  station.value = book.station ?? 0
  for (const persona of lineup) enabled[persona.role] = book.lineup[persona.role] !== false
})

function setEnabled(role: string, value: boolean) {
  enabled[role] = value
}

function setSpoiler(value: unknown) {
  if (value === '严格' || value === '可暗示' || value === '全开放') spoilerLevel.value = value
}

function setUnlock(value: unknown) {
  if (value === '关闭' || value === '逐段先写后看' || value === '章末解锁') unlockMode.value = value
}

function onStation({ selectedValues }: PickerConfirmEventParams) {
  station.value = Number(selectedValues[0] ?? 0)
  pickerOpen.value = false
}

async function save() {
  const bookId = String(route.params.bookId)
  try {
    await updateBookSettings(bookId, {
      spoilerLevel: spoilerLevel.value,
      unlockMode: unlockMode.value,
      microReviewOpen: microOpen.value,
      station: station.value || null,
      lineup: { ...enabled },
    })
  } catch (err) {
    showToast(err instanceof Error ? err.message : '保存失败')
    return
  }
  await router.replace({ name: 'reader', params: { bookId } })
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
  max-width: 600px;
  margin: 0 auto;
  padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px));
}

.setup__title {
  margin: var(--rs-space-5) var(--rs-space-4) var(--rs-space-1);
  font-family: var(--rs-font-reading);
  font-size: var(--rs-text-xl);
  font-weight: 600;
}

.setup__persona {
  font-weight: 500;
}

.setup__role {
  margin-left: var(--rs-space-2);
  color: var(--rs-muted);
  font-size: var(--rs-text-xs);
}

.setup__footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: var(--rs-space-3) var(--rs-space-4) calc(var(--rs-space-3) + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(to top, var(--rs-bg) 70%, transparent);

  .van-button {
    max-width: 568px;
    margin: 0 auto;
  }
}

:deep(.van-cell-group__title) {
  padding-top: var(--rs-space-5);
}
</style>
