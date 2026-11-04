import { defineStore } from 'pinia'
import { ref } from 'vue'
import { z } from 'zod'
import { createLlmClient } from '@/core/llm'
import { getSetting, setSetting } from '@/db/repos/settings'
import { platform } from '@/platform'

export type ReaderTheme = 'day' | 'eye' | 'night'

export interface ReaderDisplay {
  fontSize: number
  lineHeight: number
  theme: ReaderTheme
}

export const DEFAULT_DISPLAY: ReaderDisplay = {
  fontSize: 18,
  lineHeight: 1.85,
  theme: 'day',
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'
const API_KEY_SECRET = 'apiKey'

const pingSchema = z.object({
  ok: z.literal(true),
})

export const useSettingsStore = defineStore('settings', () => {
  const baseUrl = ref(DEFAULT_BASE_URL)
  const model = ref(DEFAULT_MODEL)
  const apiKey = ref('')
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
    const [savedBase, savedModel, savedKey] = await Promise.all([
      getSetting<string>('llm.baseUrl'),
      getSetting<string>('llm.model'),
      platform.getSecret(API_KEY_SECRET),
    ])
    baseUrl.value = savedBase || DEFAULT_BASE_URL
    model.value = savedModel || DEFAULT_MODEL
    apiKey.value = savedKey || ''
    loaded.value = true
  }

  async function save(input: { baseUrl: string; model: string; apiKey: string }) {
    baseUrl.value = input.baseUrl || DEFAULT_BASE_URL
    model.value = input.model || DEFAULT_MODEL
    apiKey.value = input.apiKey
    await Promise.all([
      setSetting('llm.baseUrl', baseUrl.value),
      setSetting('llm.model', model.value),
      platform.setSecret(API_KEY_SECRET, apiKey.value),
    ])
  }

  function createClient() {
    if (!apiKey.value) throw new Error('请先填写 API Key')
    return createLlmClient({
      baseUrl: baseUrl.value,
      apiKey: apiKey.value,
      model: model.value,
      fetch: platform.fetch,
    })
  }

  async function testConnection(): Promise<{
    jsonOk: boolean
    streamOk: boolean
    detail?: string
  }> {
    const client = createClient()
    let jsonOk = false
    let streamOk = false
    const parts: string[] = []

    try {
      const { data, usage } = await client.chatJson(
        [
          {
            role: 'user',
            content: '请只返回一个 JSON 对象：{"ok":true}。不要输出其他内容。json',
          },
        ],
        pingSchema,
        { temperature: 0, maxTokens: 256, timeoutMs: 30_000 },
      )
      jsonOk = data.ok === true
      parts.push(`JSON tokens=${usage.promptTokens}+${usage.completionTokens}`)
    } catch (err) {
      parts.push(`JSON: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      let text = ''
      const usage = await client.chatStream(
        [{ role: 'user', content: '只回复一个字：通' }],
        (delta) => {
          text += delta
        },
        { temperature: 0, maxTokens: 128, timeoutMs: 30_000 },
      )
      streamOk = text.trim().length > 0
      parts.push(`Stream "${text.trim()}" tokens=${usage.promptTokens}+${usage.completionTokens}`)
    } catch (err) {
      parts.push(`Stream: ${err instanceof Error ? err.message : String(err)}`)
    }

    return { jsonOk, streamOk, detail: parts.join(' | ') }
  }

  return {
    baseUrl,
    model,
    apiKey,
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
