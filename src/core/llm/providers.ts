export type LlmProtocol = 'openai' | 'anthropic' | 'gemini'

export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  protocol: LlmProtocol
  /** 用来识别已保存的地址。自定义为空。 */
  host: string
}

export const PROVIDERS: ProviderPreset[] = [
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai', host: 'openrouter.ai' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai', host: 'api.openai.com' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', host: 'api.anthropic.com' },
  {
    id: 'gemini',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    protocol: 'gemini',
    host: 'generativelanguage.googleapis.com',
  },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', protocol: 'openai', host: 'api.groq.com' },
  { id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1', protocol: 'openai', host: 'api.x.ai' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', protocol: 'openai', host: 'api.deepseek.com' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai', host: 'api.siliconflow.cn' },
  { id: 'moonshot', name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai', host: 'api.moonshot.cn' },
  { id: 'zhipu', name: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai', host: 'open.bigmodel.cn' },
  {
    id: 'dashscope',
    name: '通义（兼容模式）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    protocol: 'openai',
    host: 'dashscope.aliyuncs.com',
  },
  {
    id: 'volcengine',
    name: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    protocol: 'openai',
    host: 'ark.cn-beijing.volces.com',
  },
  { id: 'qianfan', name: '百度千帆', baseUrl: 'https://qianfan.baidubce.com/v2', protocol: 'openai', host: 'qianfan.baidubce.com' },
  { id: 'custom', name: '自定义', baseUrl: '', protocol: 'openai', host: '' },
]

const CUSTOM = PROVIDERS[PROVIDERS.length - 1]!

export function providerById(id: string | undefined): ProviderPreset {
  return PROVIDERS.find((item) => item.id === id) ?? CUSTOM
}

/** 已保存的平台 id 优先；没有或不认识时按地址识别。 */
export function resolveProviderId(id: string | undefined, baseUrl: string): string {
  if (id && providerById(id).id === id) return id
  return detectProvider(baseUrl).id
}

/** 按域名识别平台。认不出时保持自定义，调用方不要因此改写地址和模型名。 */
export function detectProvider(baseUrl: string): ProviderPreset {
  try {
    const host = new URL(baseUrl).host
    return PROVIDERS.find((item) => item.host && item.host === host) ?? CUSTOM
  } catch {
    return CUSTOM
  }
}

/** 地址已经带版本号时，不再把 `/v1` 拼第二次。 */
export function endpointUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  if (suffix.startsWith('/v1/') && /\/v\d+(?:beta)?$/i.test(base)) {
    return `${base}${suffix.slice(3)}`
  }
  return `${base}${suffix}`
}

export function authHeaders(protocol: LlmProtocol, apiKey: string): Record<string, string> {
  if (protocol === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
  }
  if (protocol === 'gemini') {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    }
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

export function parseModelIds(protocol: LlmProtocol, payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as Record<string, unknown>
  const raw = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : []
  const ids = raw
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const record = item as { id?: unknown; name?: unknown }
      const value = protocol === 'gemini' ? record.name : record.id
      return String(value ?? '').replace(/^models\//, '').trim()
    })
    .filter(Boolean)
  return [...new Set(ids)]
}

export function filterModelIds(ids: string[], query: string, limit = 40): string[] {
  const needle = query.trim().toLowerCase()
  const matched = needle ? ids.filter((id) => id.toLowerCase().includes(needle)) : ids
  return matched.slice(0, limit)
}

export interface ModelListResult {
  models: string[]
  error?: string
}

export async function listModels(input: {
  baseUrl: string
  apiKey: string
  fetch: typeof fetch
  protocol?: LlmProtocol
}): Promise<ModelListResult> {
  const baseUrl = input.baseUrl.trim()
  const apiKey = input.apiKey.trim()
  if (!apiKey) return { models: [], error: '请先填写 API Key' }
  if (!baseUrl) return { models: [], error: '请先填写接口地址' }
  const protocol = input.protocol ?? detectProvider(baseUrl).protocol
  try {
    const res = await input.fetch(endpointUrl(baseUrl, '/v1/models'), {
      method: 'GET',
      headers: authHeaders(protocol, apiKey),
    })
    if (!res.ok) return { models: [], error: `模型列表 HTTP ${res.status}` }
    const models = parseModelIds(protocol, await res.json())
    return { models }
  } catch (err) {
    return { models: [], error: err instanceof Error ? err.message : '模型列表获取失败' }
  }
}
