<template>
  <div class="settings">
    <VanNavBar title="设置" left-arrow @click-left="goBack" />
    <div class="settings__body">
      <VanCellGroup inset title="模型配置">
        <VanField v-model="baseUrl" label="接口地址" placeholder="https://api.deepseek.com" />
        <VanField v-model="model" label="模型名" placeholder="deepseek-chat" />
        <VanField v-model="apiKey" label="API Key" type="password" placeholder="仅保存在本地" />
        <VanCell title="本章说允许思考" label="章末整理在后台跑，开着更稳，但更慢也更贵">
          <template #right-icon>
            <VanSwitch v-model="chapterReasoning" size="20px" />
          </template>
        </VanCell>
      </VanCellGroup>

      <VanCellGroup inset title="计价（元 / 百万 token）" style="margin-top: 16px">
        <VanField v-model.number="pricing.inputHitPerMTok" type="number" label="输入命中缓存" />
        <VanField v-model.number="pricing.inputMissPerMTok" type="number" label="输入未命中" />
        <VanField v-model.number="pricing.outputPerMTok" type="number" label="输出" />
        <VanCell>
          <div class="settings__presets">
            <button type="button" @click="usePreset('deepseek')">DeepSeek 官方</button>
            <button type="button" @click="usePreset('free')">免费模型</button>
          </div>
        </VanCell>
      </VanCellGroup>

      <div class="settings__actions">
        <VanButton type="primary" block round :loading="saving" @click="onSave">保存</VanButton>
        <VanButton
          block
          round
          plain
          type="primary"
          :loading="testing"
          style="margin-top: 12px"
          @click="onTest"
        >
          测试连接
        </VanButton>
      </div>

      <div class="settings__actions">
        <VanButton block round plain type="primary" @click="onExport">导出备份</VanButton>
        <VanButton block round plain type="primary" style="margin-top: 12px" @click="pickBackup">
          恢复备份
        </VanButton>
        <input ref="backupInput" class="settings__file" type="file" accept="application/json,.json" @change="onRestore" />
      </div>

      <VanCellGroup v-if="testResult" inset title="最近测试" style="margin-top: 24px">
        <VanCell title="JSON" :value="testResult.json" />
        <VanCell title="流式" :value="testResult.stream" />
        <VanCell v-if="testResult.detail" title="详情" :label="testResult.detail" />
      </VanCellGroup>

      <VanCellGroup inset title="调用成本" style="margin-top: 24px">
        <VanCell v-if="costBooks.length === 0" title="还没有调用记录" />
        <VanCell v-for="book in costBooks" :key="book.bookId" :title="book.title" :label="costLabel(book)" />
      </VanCellGroup>
      <VanCellGroup v-if="costDays.length" inset title="按日期" style="margin-top: 16px">
        <VanCell
          v-for="day in costDays"
          :key="day.day"
          :title="day.day"
          :value="money(day.cost)"
          :label="`${day.calls} 次，输入 ${day.promptTokens}，输出 ${day.completionTokens}`"
        />
      </VanCellGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Button as VanButton,
  Cell as VanCell,
  CellGroup as VanCellGroup,
  Field as VanField,
  NavBar as VanNavBar,
  Switch as VanSwitch,
  showFailToast,
  showSuccessToast,
  showToast,
} from 'vant'
import { summarizeCosts, type CostBook, type CostDay } from '@/core/cost/summary'
import { exportBackup, restoreBackup } from '@/db/repos/backup'
import { listBookCards, listGenerationLogs } from '@/db/repos/library'
import { platform } from '@/platform'
import type { Pricing } from '@/core/llm'
import { PRICING_PRESETS, useSettingsStore } from '@/stores/settings'

const router = useRouter()
const settings = useSettingsStore()

const baseUrl = ref('')
const model = ref('')
const apiKey = ref('')
const chapterReasoning = ref(true)
const pricing = ref<Pricing>({ ...PRICING_PRESETS.deepseek })
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ json: string; stream: string; detail?: string } | null>(null)
const backupInput = ref<HTMLInputElement | null>(null)
const costBooks = ref<CostBook[]>([])
const costDays = ref<CostDay[]>([])

onMounted(async () => {
  await settings.load()
  baseUrl.value = settings.baseUrl
  model.value = settings.model
  apiKey.value = settings.apiKey
  chapterReasoning.value = settings.chapterReasoning
  pricing.value = { ...settings.pricing }
  const [logs, cards] = await Promise.all([listGenerationLogs(), listBookCards()])
  const titles = Object.fromEntries(cards.map((card) => [card.id, card.title]))
  const summary = summarizeCosts(logs, titles)
  costBooks.value = summary.books
  costDays.value = summary.days
})

function goBack() {
  void router.back()
}

function money(value: number) {
  return value.toFixed(4)
}

function costLabel(book: CostBook) {
  const hit = `${Math.round(book.cacheHitRate * 100)}%`
  const latency = book.latencyMs == null ? '' : `，平均 ${book.latencyMs} ms`
  const thinking = book.reasoningTokens > 0 ? `（其中思考 ${book.reasoningTokens}）` : ''
  return `${book.calls} 次，输入 ${book.promptTokens}，输出 ${book.completionTokens}${thinking}，费用 ${money(book.cost)}，缓存命中 ${hit}${latency}`
}

function usePreset(name: keyof typeof PRICING_PRESETS) {
  pricing.value = { ...PRICING_PRESETS[name] }
}

function formInput() {
  return {
    baseUrl: baseUrl.value.trim(),
    model: model.value.trim(),
    apiKey: apiKey.value.trim(),
    chapterReasoning: chapterReasoning.value,
    pricing: {
      inputHitPerMTok: Number(pricing.value.inputHitPerMTok) || 0,
      inputMissPerMTok: Number(pricing.value.inputMissPerMTok) || 0,
      outputPerMTok: Number(pricing.value.outputPerMTok) || 0,
    },
  }
}

async function onSave() {
  saving.value = true
  try {
    await settings.save(formInput())
    showSuccessToast('已保存')
  } catch (err) {
    showFailToast(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function onExport() {
  try {
    const json = await exportBackup()
    const day = new Date().toISOString().slice(0, 10)
    await platform.exportTextFile(`书友席备份-${day}.json`, json)
  } catch (err) {
    showFailToast(err instanceof Error ? err.message : '导出失败')
  }
}

function pickBackup() {
  backupInput.value?.click()
}

async function onRestore(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!window.confirm('恢复会覆盖当前的书籍和评论，API Key 会保留。继续吗？')) return
  try {
    await restoreBackup(await file.text())
    showSuccessToast('已恢复')
  } catch (err) {
    showFailToast(err instanceof Error ? err.message : '恢复失败')
  }
}

async function onTest() {
  testing.value = true
  testResult.value = null
  try {
    await settings.save(formInput())
    const result = await settings.testConnection()
    testResult.value = {
      json: result.jsonOk ? '通过' : '失败',
      stream: result.streamOk ? '通过' : '失败',
      detail: result.detail,
    }
    if (result.jsonOk && result.streamOk) {
      showSuccessToast('连通性测试通过')
    } else {
      showFailToast('连通性测试未完全通过')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '测试失败'
    testResult.value = { json: '失败', stream: '失败', detail: message }
    showToast(message)
  } finally {
    testing.value = false
  }
}
</script>

<style scoped lang="less">
.settings__body {
  padding: 16px 0 48px;
}

.settings__actions {
  padding: 24px 16px 0;
}

.settings__file {
  display: none;
}

.settings__presets {
  display: flex;
  gap: 8px;

  button {
    border: 1px solid var(--rs-border);
    background: transparent;
    color: inherit;
    border-radius: 999px;
    padding: 4px 10px;
  }
}
</style>
