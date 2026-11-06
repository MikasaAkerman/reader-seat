<template>
  <div class="settings">
    <VanNavBar title="设置" left-arrow @click-left="goBack" />
    <div class="settings__body">
      <VanCellGroup inset title="模型">
        <VanCell title="平台" :value="providerName" is-link @click="providerOpen = true" />
        <VanField v-model="baseUrl" label="接口地址" placeholder="https://api.deepseek.com" />
        <VanField v-model="apiKey" label="API Key" type="password" placeholder="只保存在本机" />
        <ModelCombo v-model="model" :options="modelOptions" :loading="listing" @refresh="onListModels" />
        <VanCell>
          <template #title>
            <InfoTip text="本章说在章末后台整理。开着更稳，但更慢，也更费 token。">本章说允许思考</InfoTip>
          </template>
          <template #right-icon>
            <VanSwitch v-model="chapterReasoning" size="20px" aria-label="本章说允许思考" />
          </template>
        </VanCell>
      </VanCellGroup>

      <div class="settings__actions">
        <VanButton type="primary" round :loading="saving" @click="onSave">保存</VanButton>
        <VanButton round plain type="primary" icon="exchange" :loading="testing" @click="onTest">测试连接</VanButton>
      </div>
      <div v-if="testResult" class="settings__test" role="status">
        <VanTag :type="testResult.jsonOk ? 'success' : 'danger'" plain round>
          JSON {{ testResult.jsonOk ? '通过' : '失败' }}
        </VanTag>
        <VanTag :type="testResult.streamOk ? 'success' : 'danger'" plain round>
          流式 {{ testResult.streamOk ? '通过' : '失败' }}
        </VanTag>
        <p v-if="testResult.detail" class="settings__detail">{{ testResult.detail }}</p>
      </div>

      <div class="settings__group">
        <VanCollapse v-model="expanded">
          <VanCollapseItem name="pricing" title="计价" :value="pricingLabel" icon="balance-o">
            <VanField v-model.number="pricing.inputHitPerMTok" type="number" label="输入命中缓存" />
            <VanField v-model.number="pricing.inputMissPerMTok" type="number" label="输入未命中" />
            <VanField v-model.number="pricing.outputPerMTok" type="number" label="输出" />
            <div class="settings__presets">
              <span>预设</span>
              <VanButton size="small" round @click="usePreset('deepseek')">DeepSeek 官方</VanButton>
              <VanButton size="small" round @click="usePreset('free')">免费模型</VanButton>
            </div>
            <p class="settings__unit">单位：元 / 百万 token。改完记得点上面的保存。</p>
          </VanCollapseItem>
          <VanCollapseItem name="cost" title="调用成本" :value="totalLabel" icon="chart-trending-o">
            <p v-if="costBooks.length === 0" class="settings__unit">还没有调用记录</p>
            <template v-else>
              <h3 class="settings__sub">按书</h3>
              <div v-for="book in costBooks" :key="book.bookId" class="settings__row">
                <div>
                  <strong>{{ book.title }}</strong>
                  <small>{{ costLabel(book) }}</small>
                </div>
                <span>{{ money(book.cost) }}</span>
              </div>
              <template v-if="quality">
                <h3 class="settings__sub">质量</h3>
                <p class="settings__unit">
                  丢弃率 {{ Math.round(quality.dropRate * 100) }}% · 多样度 {{ quality.diversity.toFixed(2) }} · 引文
                  {{ quality.dropped.quote }} · 重复 {{ quality.dropped.duplicate }} · 实体
                  {{ quality.dropped.entity }} · 外部 {{ quality.dropped.outside }} · 剧透
                  {{ quality.dropped.spoiler }}
                </p>
                <div v-for="row in quality.byModel" :key="row.model" class="settings__row">
                  <div>
                    <strong>{{ row.model }}</strong>
                    <small>{{ row.calls }} 次</small>
                  </div>
                  <span>{{ money(row.cost) }}</span>
                </div>
              </template>
              <h3 class="settings__sub">按日期</h3>
              <div v-for="day in costDays" :key="day.day" class="settings__row">
                <div>
                  <strong>{{ day.day }}</strong>
                  <small>{{ day.calls }} 次 · 输入 {{ day.promptTokens }} · 输出 {{ day.completionTokens }}</small>
                </div>
                <span>{{ money(day.cost) }}</span>
              </div>
            </template>
          </VanCollapseItem>
        </VanCollapse>
      </div>

      <VanCellGroup inset title="数据">
        <VanCell title="导出备份" icon="down" is-link @click="onExport" />
        <VanCell title="恢复备份" icon="replay" label="会覆盖当前书籍和评论" is-link @click="pickBackup" />
      </VanCellGroup>
      <input ref="backupInput" class="settings__file" type="file" accept="application/json,.json" @change="onRestore" />
    </div>

    <VanPopup v-model:show="providerOpen" position="bottom" round>
      <div class="settings__sheet">
        <div class="settings__sheet-bar">
          <button type="button" class="settings__sheet-action" @click="providerOpen = false">取消</button>
          <strong>选择平台</strong>
          <span class="settings__sheet-action" aria-hidden="true"></span>
        </div>
        <ul ref="providerList" class="settings__providers" role="listbox" aria-label="选择平台">
          <li v-for="item in providerColumns" :key="item.value">
            <button
              type="button"
              role="option"
              :aria-selected="item.value === providerId"
              :class="{ 'is-current': item.value === providerId }"
              :data-provider="item.value"
              @click="selectProvider(item.value)"
            >
              {{ item.text }}
            </button>
          </li>
        </ul>
      </div>
    </VanPopup>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Button as VanButton,
  Cell as VanCell,
  CellGroup as VanCellGroup,
  Collapse as VanCollapse,
  CollapseItem as VanCollapseItem,
  Field as VanField,
  NavBar as VanNavBar,
  Popup as VanPopup,
  Switch as VanSwitch,
  Tag as VanTag,
  showConfirmDialog,
  showFailToast,
  showSuccessToast,
  showToast,
} from 'vant'
import InfoTip from '@/components/common/InfoTip.vue'
import ModelCombo from '@/components/common/ModelCombo.vue'
import { summarizeCosts, summarizeQuality, type CostBook, type CostDay, type QualitySummary } from '@/core/cost/summary'
import { exportBackup, restoreBackup } from '@/db/repos/backup'
import { listCommentsForDiversity } from '@/db/repos/comments'
import { listBookCards, listGenerationLogs } from '@/db/repos/library'
import { platform } from '@/platform'
import { PROVIDERS, listModels, providerById, type Pricing } from '@/core/llm'
import { PRICING_PRESETS, useSettingsStore } from '@/stores/settings'

const router = useRouter()
const settings = useSettingsStore()

const providerId = ref('deepseek')
const baseUrl = ref('')
const model = ref('')
const apiKey = ref('')
const modelOptions = ref<string[]>([])
const providerOpen = ref(false)
const providerList = ref<HTMLElement | null>(null)
const listing = ref(false)
const fetchedKey = ref('')
let hydrating = true
let keyTimer = 0
let listQueued = false
const providerColumns = PROVIDERS.map((item) => ({ text: item.name, value: item.id }))
const providerName = computed(() => providerById(providerId.value).name)
const chapterReasoning = ref(true)
const pricing = ref<Pricing>({ ...PRICING_PRESETS.deepseek })
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ jsonOk: boolean; streamOk: boolean; detail?: string } | null>(null)
const expanded = ref<string[]>([])
const backupInput = ref<HTMLInputElement | null>(null)
const costBooks = ref<CostBook[]>([])
const costDays = ref<CostDay[]>([])
const quality = ref<QualitySummary | null>(null)

const totalLabel = computed(() => {
  if (costBooks.value.length === 0) return '暂无'
  const calls = costBooks.value.reduce((sum, book) => sum + book.calls, 0)
  const cost = costBooks.value.reduce((sum, book) => sum + book.cost, 0)
  return `${calls} 次 · ¥${money(cost)}`
})
const pricingLabel = computed(() => {
  const { inputHitPerMTok, inputMissPerMTok, outputPerMTok } = pricing.value
  if (!inputHitPerMTok && !inputMissPerMTok && !outputPerMTok) return '免费'
  return `${inputMissPerMTok} / ${outputPerMTok}`
})

onMounted(async () => {
  await settings.load()
  providerId.value = settings.providerId
  baseUrl.value = settings.baseUrl
  model.value = settings.model
  apiKey.value = settings.apiKey
  chapterReasoning.value = settings.chapterReasoning
  pricing.value = { ...settings.pricing }
  hydrating = false
  const [logs, cards] = await Promise.all([listGenerationLogs(), listBookCards()])
  const titles = Object.fromEntries(cards.map((card) => [card.id, card.title]))
  const summary = summarizeCosts(logs, titles)
  costBooks.value = summary.books
  costDays.value = summary.days
  const firstBook = summary.books[0]?.bookId
  const comments = firstBook ? await listCommentsForDiversity(firstBook) : []
  const bookLogs = firstBook ? logs.filter((log) => log.bookId === firstBook) : logs
  quality.value = summarizeQuality(bookLogs, comments)
})

watch(providerOpen, async (open) => {
  if (!open) return
  await nextTick()
  const list = providerList.value
  const current = list?.querySelector<HTMLElement>(`[data-provider="${providerId.value}"]`)
  if (!list || !current) return
  list.scrollTop = current.offsetTop - list.clientHeight / 2 + current.clientHeight / 2
})

watch(apiKey, (value) => {
  if (hydrating) return
  window.clearTimeout(keyTimer)
  const next = value.trim()
  if (!next || next === fetchedKey.value) return
  keyTimer = window.setTimeout(() => {
    if (apiKey.value.trim() === next) void onListModels(false)
  }, 400)
})

function goBack() {
  void router.back()
}

function money(value: number) {
  return value.toFixed(4)
}

function costLabel(book: CostBook) {
  const hit = `${Math.round(book.cacheHitRate * 100)}%`
  const latency = book.latencyMs == null ? '' : ` · 平均 ${book.latencyMs} ms`
  const thinking = book.reasoningTokens > 0 ? `（其中思考 ${book.reasoningTokens}）` : ''
  return `${book.calls} 次 · 输入 ${book.promptTokens} · 输出 ${book.completionTokens}${thinking} · 缓存命中 ${hit}${latency}`
}

function usePreset(name: keyof typeof PRICING_PRESETS) {
  pricing.value = { ...PRICING_PRESETS[name] }
}

function selectProvider(id: string) {
  providerId.value = id
  const preset = providerById(id)
  if (id !== 'custom') baseUrl.value = preset.baseUrl
  modelOptions.value = []
  providerOpen.value = false
}

async function onListModels(announce = true) {
  if (listing.value) {
    listQueued = true
    return
  }
  const key = apiKey.value.trim()
  if (!key) {
    if (announce) showToast('请先填写 API Key')
    return
  }
  listing.value = true
  try {
    const result = await listModels({
      baseUrl: baseUrl.value,
      apiKey: key,
      protocol: providerById(providerId.value).protocol,
      fetch: platform.fetch,
    })
    fetchedKey.value = key
    modelOptions.value = result.models
    if (result.error) showFailToast(result.error)
    else if (result.models.length === 0) showToast('没有拉到模型，可以直接填写')
    else if (announce) showSuccessToast(`已获取 ${result.models.length} 个模型`)
  } finally {
    listing.value = false
    if (listQueued) {
      listQueued = false
      const next = apiKey.value.trim()
      if (next && next !== fetchedKey.value) void onListModels(false)
    }
  }
}

function formInput() {
  return {
    providerId: providerId.value,
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
  try {
    await showConfirmDialog({
      title: '恢复备份',
      message: '恢复会覆盖当前的书籍和评论，API Key 会保留。',
      confirmButtonText: '覆盖并恢复',
      confirmButtonColor: 'var(--rs-danger)',
    })
  } catch {
    return
  }
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
    testResult.value = { jsonOk: result.jsonOk, streamOk: result.streamOk, detail: result.detail }
    if (result.jsonOk && result.streamOk) {
      showSuccessToast('连通性测试通过')
    } else {
      showFailToast('连通性测试未完全通过')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '测试失败'
    testResult.value = { jsonOk: false, streamOk: false, detail: message }
    showToast(message)
  } finally {
    testing.value = false
  }
}

</script>

<style scoped lang="less">
.settings {
  min-height: 100vh;
  background: var(--rs-bg);
}

.settings__body {
  max-width: 640px;
  margin: 0 auto;
  padding: 0 0 calc(48px + env(safe-area-inset-bottom, 0px));
}

.settings__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--rs-space-3);
  padding: var(--rs-space-4) var(--rs-space-4) 0;
}

.settings__test {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--rs-space-2);
  padding: var(--rs-space-3) var(--rs-space-4) 0;
}

.settings__detail {
  width: 100%;
  margin: 0;
  color: var(--rs-muted);
  font-size: var(--rs-text-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.settings__group {
  margin: var(--rs-space-5) var(--rs-space-4) 0;
  border-radius: var(--rs-radius-md);
  overflow: hidden;

  :deep(.van-collapse-item__content) {
    padding: var(--rs-space-1) 0 var(--rs-space-3);
    color: var(--rs-text);
  }

  :deep(.van-collapse-item__content .van-cell) {
    padding-left: var(--rs-space-4);
  }
}

.settings__presets {
  display: flex;
  align-items: center;
  gap: var(--rs-space-2);
  padding: var(--rs-space-3) var(--rs-space-4) 0;

  span {
    color: var(--rs-muted);
    font-size: var(--rs-text-sm);
  }
}

.settings__unit {
  margin: var(--rs-space-2) var(--rs-space-4) 0;
  color: var(--rs-muted);
  font-size: var(--rs-text-xs);
}

.settings__sub {
  margin: var(--rs-space-2) var(--rs-space-4) var(--rs-space-1);
  color: var(--rs-muted);
  font-size: var(--rs-text-xs);
  font-weight: 500;
}

.settings__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-3);
  padding: var(--rs-space-2) var(--rs-space-4);

  div {
    min-width: 0;
  }

  strong,
  small {
    display: block;
  }

  strong {
    font-size: var(--rs-text-sm);
    font-weight: 500;
  }

  small {
    margin-top: 2px;
    color: var(--rs-muted);
    font-size: var(--rs-text-xs);
    line-height: 1.5;
  }

  > span {
    flex: none;
    font-size: var(--rs-text-sm);
    font-variant-numeric: tabular-nums;
  }
}

.settings__file {
  display: none;
}

.settings__sheet {
  display: flex;
  flex-direction: column;
  max-height: 70vh;
}

.settings__sheet-bar {
  display: grid;
  grid-template-columns: 64px 1fr 64px;
  align-items: center;
  height: 44px;
  padding: 0 var(--rs-space-2);

  strong {
    font-size: var(--rs-text-lg);
    font-weight: 500;
    text-align: center;
  }
}

.settings__sheet-action {
  padding: 0 var(--rs-space-2);
  border: 0;
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-text-md);
  text-align: left;
}

.settings__providers {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0 0 env(safe-area-inset-bottom, 0px);
  overflow-y: auto;
  list-style: none;
  -webkit-overflow-scrolling: touch;

  button {
    width: 100%;
    padding: var(--rs-space-3) var(--rs-space-4);
    border: 0;
    background: transparent;
    color: var(--rs-text);
    font-size: var(--rs-text-md);
  }

  .is-current {
    color: var(--rs-accent);
    font-weight: 600;
  }
}
</style>
