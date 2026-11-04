import { createParser, type EventSourceMessage } from 'eventsource-parser'
import type { ZodType } from 'zod'
import {
  EMPTY_USAGE,
  type CallOptions,
  type ChatMessage,
  type LlmClient,
  type LlmConfig,
  type LlmUsage,
  type Pricing,
} from './types'

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  if (suffix.startsWith('/v1/') && base.endsWith('/v1')) {
    return `${base}${suffix.slice('/v1'.length)}`
  }
  return `${base}${suffix}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseUsage(raw: unknown): LlmUsage {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_USAGE }
  const u = raw as Record<string, unknown>
  return {
    promptTokens: Number(u.prompt_tokens ?? 0),
    completionTokens: Number(u.completion_tokens ?? 0),
    cacheHitTokens: Number(u.prompt_cache_hit_tokens ?? 0),
  }
}

export function takeCompleteLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.map((line) => line.trim()).filter(Boolean), rest }
}

function parseJsonlLine<T>(line: string, schema: ZodType<T>): T | null {
  const cleaned = line.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  if (!cleaned || cleaned === '[' || cleaned === ']') return null
  try {
    return schema.parse(JSON.parse(cleaned))
  } catch {
    return null
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

// 推理模型会把补全额度全部用在思考上，finish_reason=length 且 content 为空。
// effort 与 max_tokens 不能同时传。先用低档；若仍被截断，下一次关闭推理。
const reasoningBudget = { effort: 'low' }

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (isAbort(err)) break
      if (i < retries) await sleep(2000)
    }
  }
  throw lastError
}

export function estimateCost(usage: LlmUsage, pricing: Pricing): number {
  const miss = Math.max(0, usage.promptTokens - usage.cacheHitTokens)
  return (
    (usage.cacheHitTokens / 1_000_000) * pricing.inputHitPerMTok +
    (miss / 1_000_000) * pricing.inputMissPerMTok +
    (usage.completionTokens / 1_000_000) * pricing.outputPerMTok
  )
}

export function createLlmClient(config: LlmConfig): LlmClient {
  const { baseUrl, apiKey, model, fetch: fetchFn } = config

  async function postChat(body: Record<string, unknown>, opts?: CallOptions): Promise<Response> {
    const controller = new AbortController()
    const timeout = opts?.timeoutMs ?? 60_000
    const timer = setTimeout(() => controller.abort(), timeout)
    const signal = opts?.signal
      ? AbortSignal.any([controller.signal, opts.signal])
      : controller.signal

    try {
      const res = await fetchFn(joinUrl(baseUrl, '/v1/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, ...body }),
        signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
      return res
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>, opts?: CallOptions) {
      let reasoning: { effort: string } = { ...reasoningBudget }
      return withRetry(async () => {
        const res = await postChat(
          {
            messages,
            temperature: opts?.temperature ?? 1,
            max_tokens: opts?.maxTokens ?? 2000,
            stream: false,
            response_format: { type: 'json_object' },
            reasoning,
          },
          opts,
        )
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
          usage?: unknown
        }
        const content = json.choices?.[0]?.message?.content
        const finishReason = json.choices?.[0]?.finish_reason ?? ''
        if (finishReason === 'length') reasoning = { effort: 'none' }
        if (!content) throw new Error('LLM returned empty content')
        const parsed: unknown = JSON.parse(content)
        const data = schema.parse(parsed)
        return { data, usage: parseUsage(json.usage) }
      })
    },

    async chatStream(messages: ChatMessage[], onDelta: (text: string) => void, opts?: CallOptions) {
      return withRetry(async () => {
        const res = await postChat(
          {
            messages,
            temperature: opts?.temperature ?? 1,
            max_tokens: opts?.maxTokens ?? 800,
            stream: true,
            stream_options: { include_usage: true },
            reasoning: reasoningBudget,
          },
          { ...opts, timeoutMs: opts?.timeoutMs ?? 60_000 },
        )

        if (!res.body) throw new Error('LLM stream response has no body')

        let usage: LlmUsage = { ...EMPTY_USAGE }
        const parser = createParser({
          onEvent(event: EventSourceMessage) {
            if (!event.data || event.data === '[DONE]') return
            try {
              const chunk = JSON.parse(event.data) as {
                choices?: Array<{ delta?: { content?: string } }>
                usage?: unknown
              }
              const delta = chunk.choices?.[0]?.delta?.content
              if (delta) onDelta(delta)
              if (chunk.usage) usage = parseUsage(chunk.usage)
            } catch {
              // ignore malformed SSE lines
            }
          },
        })

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          parser.feed(decoder.decode(value, { stream: true }))
        }
        return usage
      })
    },

    async chatJsonl<T>(
      messages: ChatMessage[],
      schema: ZodType<T>,
      onItem: (item: T) => void,
      opts?: CallOptions,
    ) {
      return withRetry(async () => {
        const started = Date.now()
        const controller = new AbortController()
        const signal = opts?.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal
        let sawItem = false
        let timer = setTimeout(() => controller.abort(), 15_000)
        const extend = () => {
          clearTimeout(timer)
          timer = setTimeout(() => controller.abort(), Math.max(0, 60_000 - (Date.now() - started)))
        }
        try {
          const res = await fetchFn(joinUrl(baseUrl, '/v1/chat/completions'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages,
              temperature: opts?.temperature ?? 1.3,
              max_tokens: opts?.maxTokens ?? 800,
              stream: true,
              stream_options: { include_usage: true },
              reasoning: reasoningBudget,
            }),
            signal,
          })
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`)
          }
          if (!res.body) throw new Error('LLM stream response has no body')
          let usage: LlmUsage = { ...EMPTY_USAGE }
          let pending = ''
          const accept = (line: string) => {
            const item = parseJsonlLine(line, schema)
            if (!item) return
            if (!sawItem) {
              sawItem = true
              extend()
            }
            onItem(item)
          }
          const parser = createParser({
            onEvent(event: EventSourceMessage) {
              if (!event.data || event.data === '[DONE]') return
              try {
                const chunk = JSON.parse(event.data) as {
                  choices?: Array<{ delta?: { content?: string } }>
                  usage?: unknown
                }
                const delta = chunk.choices?.[0]?.delta?.content
                if (delta) {
                  pending += delta
                  const taken = takeCompleteLines(pending)
                  pending = taken.rest
                  for (const line of taken.lines) accept(line)
                }
                if (chunk.usage) usage = parseUsage(chunk.usage)
              } catch {
                // 半行或坏掉的 SSE 先留着，等下一段。
              }
            },
          })
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            parser.feed(decoder.decode(value, { stream: true }))
          }
          if (pending.trim()) accept(pending.trim())
          return usage
        } finally {
          clearTimeout(timer)
        }
      })
    },
  }
}
