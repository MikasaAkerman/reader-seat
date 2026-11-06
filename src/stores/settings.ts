import { defineStore } from 'pinia'
import { ref } from 'vue'
import { z } from 'zod'
import { createLlmClient, providerById, resolveProviderId, type Pricing } from '@/core/llm'
import { getSetting, setSetting } from '@/db/repos/settings'
import { platform } from '@/platform'

export type ReaderTheme = 'day' | 'eye' | 'night'

export interface ReaderDisplay {
  fontSize: number
  lineHeight: number
  theme: ReaderTheme
  danmaku: boolean
}

export const DEFAULT_DISPLAY: ReaderDisplay = {
  fontSize: 18,
  lineHeight: 1.85,
  theme: 'day',
  danmaku: false,
}

/** 单位：元 / 百万 token。 */
export const PRICING_PRESETS: Record<'deepseek' | 'free', Pricing> = {
  deepseek: { inputHitPerMTok: 0.2, inputMissPerMTok: 2, outputPerMTok: 3 },
  free: { inputHitPerMTok: 0, inputMissPerMTok: 0, outputPerMTok: 0 },
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'
const API_KEY_SECRET = 'apiKey'

const pingSchema = z.object({
  ok: z.literal(true),
})

function validPricing(value: unknown): Pricing | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const fields = ['inputHitPerMTok', 'inputMissPerMTok', 'outputPerMTok'] as const
  if (!fields.every((key) => typeof record[key] === 'number' && Number.isFinite(record[key]))) return null
  return {
    inputHitPerMTok: record.inputHitPerMTok as number,
    inputMissPerMTok: record.inputMissPerMTok as number,
    outputPerMTok: record.outputPerMTok as number,
  }
}

export function defaultPricingFor(baseUrl: string, model: string): Pricing {
  if (/openrouter\.ai/i.test(baseUrl) && /free/i.test(model)) return { ...PRICING_PRESETS.free }
  return { ...PRICING_PRESETS.deepseek }
}

export interface SettingsInput {
  providerId?: string
  baseUrl: string
  model: string
  apiKey: string
  chapterReasoning?: boolean
  pricing?: Pricing
}

export const useSettingsStore = defineStore('settings', () => {
  const providerId = ref('deepseek')
  const baseUrl = ref(DEFAULT_BASE_URL)
  const model = ref(DEFAULT_MODEL)
  const apiKey = ref('')
  const chapterReasoning = ref(true)
  const pricing = ref<Pricing>({ ...PRICING_PRESETS.deepseek })
  const loaded = ref(false)
  const display = ref<ReaderDisplay>({ ...DEFAULT_DISPLAY })

  function applyDisplay(next: ReaderDisplay = display.value) {
    const root = document.documentElement
    root.dataset.readerTheme = next.theme
    root.style.setProperty('--rs-font-size', `${next.fontSize}px`)
    root.style.setProperty('--rs-line-height', String(next.lineHeight))
  }

  async function loadDisplay() {
    const saved = await getSetting<ReaderDisplay>('reader.display')
    if (saved?.fontSize && saved.lineHeight && saved.theme) {
      display.value = {
        fontSize: saved.fontSize,
        lineHeight: saved.lineHeight,
        theme: saved.theme,
        danmaku: saved.danmaku === true,
      }
    }
    applyDisplay()
  }

  async function saveDisplay(next: ReaderDisplay) {
    display.value = next
    applyDisplay(next)
    await setSetting('reader.display', next)
  }

  async function load() {
    const [savedProvider, savedBase, savedModel, savedKey, savedReasoning, savedPricing] = await Promise.all([
      getSetting<string>('llm.provider'),
      getSetting<string>('llm.baseUrl'),
      getSetting<string>('llm.model'),
      platform.getSecret(API_KEY_SECRET),
      getSetting<boolean>('llm.chapterReasoning'),
      getSetting<unknown>('llm.pricing'),
    ])
    baseUrl.value = savedBase || DEFAULT_BASE_URL
    providerId.value = resolveProviderId(savedProvider, baseUrl.value)
    model.value = savedModel || DEFAULT_MODEL
    apiKey.value = savedKey || ''
    chapterReasoning.value = savedReasoning !== false
    pricing.value = validPricing(savedPricing) ?? defaultPricingFor(baseUrl.value, model.value)
    loaded.value = true
  }

  async function save(input: SettingsInput) {
    baseUrl.value = input.baseUrl || DEFAULT_BASE_URL
    providerId.value = resolveProviderId(input.providerId, baseUrl.value)
    model.value = input.model || DEFAULT_MODEL
    apiKey.value = input.apiKey
    if (input.chapterReasoning !== undefined) chapterReasoning.value = input.chapterReasoning
    if (input.pricing) pricing.value = validPricing(input.pricing) ?? pricing.value
    await Promise.all([
      setSetting('llm.provider', providerId.value),
      setSetting('llm.baseUrl', baseUrl.value),
      setSetting('llm.model', model.value),
      setSetting('llm.chapterReasoning', chapterReasoning.value),
      setSetting('llm.pricing', { ...pricing.value }),
      platform.setSecret(API_KEY_SECRET, apiKey.value),
    ])
  }

  function createClient() {
    if (!apiKey.value) throw new Error('请先填写 API Key')
    return createLlmClient({
      baseUrl: baseUrl.value,
      apiKey: apiKey.value,
      model: model.value,
      protocol: providerById(providerId.value).protocol,
      fetch: platform.fetch,
    })
  }

  async function ping(client: ReturnType<typeof createLlmClient>): Promise<{
    jsonOk: boolean
    streamOk: boolean
    detail?: string
  }> {
    let jsonOk = false
    let streamOk = false
    const parts: string[] = []

    try {
      const started = Date.now()
      const { data, usage } = await client.chatJson(
        [
          {
            role: 'user',
            content: '请只返回一个 JSON 对象：{"ok":true}。不要输出其他内容。json',
          },
        ],
        pingSchema,
        { maxTokens: 256, timeoutMs: 30_000 },
      )
      jsonOk = data.ok === true
      parts.push(
        `JSON tokens=${usage.promptTokens}+${usage.completionTokens}（思考 ${usage.reasoningTokens}）${Date.now() - started}ms`,
      )
    } catch (err) {
      parts.push(`JSON: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      const started = Date.now()
      let text = ''
      const usage = await client.chatStream(
        [{ role: 'user', content: '只回复一个字：通' }],
        (delta) => {
          text += delta
        },
        { maxTokens: 128, timeoutMs: 30_000 },
      )
      streamOk = text.trim().length > 0
      parts.push(
        `Stream "${text.trim()}" tokens=${usage.promptTokens}+${usage.completionTokens} ${Date.now() - started}ms`,
      )
    } catch (err) {
      parts.push(`Stream: ${err instanceof Error ? err.message : String(err)}`)
    }

    return { jsonOk, streamOk, detail: parts.join(' | ') }
  }

  async function testConnection() {
    return ping(createClient())
  }

  return {
    providerId,
    baseUrl,
    model,
    apiKey,
    chapterReasoning,
    pricing,
    loaded,
    display,
    load,
    loadDisplay,
    saveDisplay,
    save,
    createClient,
    testConnection,
  }
})
