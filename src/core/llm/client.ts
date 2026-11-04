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
  type ReasoningMode,
} from './types'

export class LlmError extends Error {
  readonly retryable: boolean
  readonly status?: number
  readonly truncated: boolean
  readonly reasoningRejected: boolean

  constructor(
    message: string,
    init: { retryable: boolean; status?: number; truncated?: boolean; reasoningRejected?: boolean },
  ) {
    super(message)
    this.name = 'LlmError'
    this.retryable = init.retryable
    this.status = init.status
    this.truncated = init.truncated === true
    this.reasoningRejected = init.reasoningRejected === true
  }
}

interface Attempt {
  maxTokens: number
  sendReasoning: boolean
}

interface Timing {
  totalMs: number
  /** 流式 JSONL：第一条结果出现前的等待上限 */
  firstItemMs?: number
}

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string } }>
  usage?: unknown
}

const JSONL_FIRST_ITEM_MS = 20_000

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
  const details = u.completion_tokens_details as Record<string, unknown> | undefined
  return {
    promptTokens: Number(u.prompt_tokens ?? 0),
    completionTokens: Number(u.completion_tokens ?? 0),
    cacheHitTokens: Number(u.prompt_cache_hit_tokens ?? 0),
    reasoningTokens: Number(details?.reasoning_tokens ?? 0),
  }
}

export function takeCompleteLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.map((line) => line.trim()).filter(Boolean), rest }
}

function parseJsonlLine<T>(line: string, schema: ZodType<T>): T | null {
  const cleaned = line
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .replace(/,$/, '')
    .trim()
  if (!cleaned || cleaned === '[' || cleaned === ']') return null
  try {
    return schema.parse(JSON.parse(cleaned))
  } catch {
    return null
  }
}

/** 有些模型会把 JSON 包在代码块里，或在前后多说一句。 */
export function parseJsonContent(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch (err) {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) throw err
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

/**
 * OpenRouter 的统一推理参数：effort 为 none 时关闭思考。
 * DeepSeek 等直连服务商靠模型选择（chat / reasoner）决定是否思考，不传这个字段。
 */
function reasoningField(baseUrl: string, mode: ReasoningMode): Record<string, unknown> | null {
  if (!/openrouter\.ai/i.test(baseUrl)) return null
  return { effort: mode === 'low' ? 'low' : 'none' }
}

export function estimateCost(usage: LlmUsage, pricing: Pricing): number {
  const miss = Math.max(0, usage.promptTokens - usage.cacheHitTokens)
  return (
    (usage.cacheHitTokens / 1_000_000) * pricing.inputHitPerMTok +
    (miss / 1_000_000) * pricing.inputMissPerMTok +
    (usage.completionTokens / 1_000_000) * pricing.outputPerMTok
  )
}

async function readSse(res: Response, onChunk: (chunk: StreamChunk) => void): Promise<void> {
  if (!res.body) throw new LlmError('LLM stream response has no body', { retryable: true })
  const parser = createParser({
    onEvent(event: EventSourceMessage) {
      if (!event.data || event.data === '[DONE]') return
      let chunk: StreamChunk
      try {
        chunk = JSON.parse(event.data) as StreamChunk
      } catch {
        return
      }
      onChunk(chunk)
    },
  })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parser.feed(decoder.decode(value, { stream: true }))
  }
}

export function createLlmClient(config: LlmConfig): LlmClient {
  const { baseUrl, apiKey, model, fetch: fetchFn } = config
  const retryDelayMs = config.retryDelayMs ?? 2000

  function firstAttempt(opts: CallOptions | undefined, fallbackMaxTokens: number): Attempt {
    return {
      maxTokens: opts?.maxTokens ?? fallbackMaxTokens,
      sendReasoning: reasoningField(baseUrl, opts?.reasoning ?? 'off') !== null,
    }
  }

  /** 截断时放大一次预算；服务商不认推理参数时去掉它；其余可重试错误只重试一次。 */
  async function withRetry<T>(initial: Attempt, run: (attempt: Attempt) => Promise<T>): Promise<T> {
    let attempt = initial
    let retriesLeft = 1
    let grown = false
    for (;;) {
      try {
        return await run(attempt)
      } catch (err) {
        if (isAbort(err)) throw err
        if (err instanceof LlmError) {
          if (err.reasoningRejected && attempt.sendReasoning) {
            attempt = { ...attempt, sendReasoning: false }
            continue
          }
          if (err.truncated && !grown) {
            grown = true
            attempt = { ...attempt, maxTokens: Math.ceil(attempt.maxTokens * 1.5) }
            continue
          }
          if (!err.retryable) throw err
        }
        if (retriesLeft <= 0) throw err
        retriesLeft -= 1
        if (retryDelayMs > 0) await sleep(retryDelayMs)
      }
    }
  }

  /** 超时覆盖整个请求，包括读响应体。 */
  async function request<T>(
    body: Record<string, unknown>,
    attempt: Attempt,
    opts: CallOptions | undefined,
    timing: Timing,
    read: (res: Response, touch: () => void) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    const started = Date.now()
    let timedOut = false
    const arm = (ms: number) =>
      setTimeout(() => {
        timedOut = true
        controller.abort()
      }, Math.max(0, ms))
    let timer = arm(timing.firstItemMs ?? timing.totalMs)
    let touched = false
    const touch = () => {
      if (touched || timing.firstItemMs === undefined) return
      touched = true
      clearTimeout(timer)
      timer = arm(timing.totalMs - (Date.now() - started))
    }
    const signal = opts?.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal
    const reasoning = attempt.sendReasoning ? reasoningField(baseUrl, opts?.reasoning ?? 'off') : null

    try {
      const res = await fetchFn(joinUrl(baseUrl, '/v1/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          ...body,
          max_tokens: attempt.maxTokens,
          ...(reasoning ? { reasoning } : {}),
        }),
        signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new LlmError(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`, {
          status: res.status,
          retryable: retryableStatus(res.status),
          reasoningRejected: res.status === 400 && reasoning !== null && /reason/i.test(text),
        })
      }
      return await read(res, touch)
    } catch (err) {
      if (timedOut && !opts?.signal?.aborted) throw new LlmError('LLM 请求超时', { retryable: true })
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>, opts?: CallOptions) {
      return withRetry(firstAttempt(opts, 2000), (attempt) =>
        request(
          {
            messages,
            temperature: opts?.temperature ?? 1,
            stream: false,
            response_format: { type: 'json_object' },
          },
          attempt,
          opts,
          { totalMs: opts?.timeoutMs ?? 60_000 },
          async (res) => {
            const json = (await res.json()) as {
              choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
              usage?: unknown
            }
            const content = json.choices?.[0]?.message?.content
            const truncated = json.choices?.[0]?.finish_reason === 'length'
            if (!content) {
              throw new LlmError(truncated ? 'LLM 输出被截断' : 'LLM returned empty content', {
                retryable: true,
                truncated,
              })
            }
            let data: T
            try {
              data = schema.parse(parseJsonContent(content))
            } catch (err) {
              if (truncated) throw new LlmError('LLM 输出被截断', { retryable: true, truncated: true })
              throw err
            }
            return { data, usage: parseUsage(json.usage) }
          },
        ),
      )
    },

    async chatStream(messages: ChatMessage[], onDelta: (text: string) => void, opts?: CallOptions) {
      let emitted = false
      return withRetry(firstAttempt(opts, 800), async (attempt) => {
        try {
          return await request(
            {
              messages,
              temperature: opts?.temperature ?? 1,
              stream: true,
              stream_options: { include_usage: true },
            },
            attempt,
            opts,
            { totalMs: opts?.timeoutMs ?? 60_000 },
            async (res) => {
              let usage: LlmUsage = { ...EMPTY_USAGE }
              await readSse(res, (chunk) => {
                const delta = chunk.choices?.[0]?.delta?.content
                if (delta) {
                  emitted = true
                  onDelta(delta)
                }
                if (chunk.usage) usage = parseUsage(chunk.usage)
              })
              return usage
            },
          )
        } catch (err) {
          // 已经推给界面的文字收不回来，重试会让用户看到两遍。
          if (emitted && !isAbort(err)) {
            throw new LlmError(err instanceof Error ? err.message : String(err), { retryable: false })
          }
          throw err
        }
      })
    },

    async chatJsonl<T>(
      messages: ChatMessage[],
      schema: ZodType<T>,
      onItem: (item: T) => void,
      opts?: CallOptions,
    ) {
      let delivered = 0
      const totalMs = opts?.timeoutMs ?? 60_000
      return withRetry(firstAttempt(opts, 800), (attempt) => {
        let seen = 0
        return request(
          {
            messages,
            temperature: opts?.temperature ?? 1.3,
            stream: true,
            stream_options: { include_usage: true },
          },
          attempt,
          opts,
          { totalMs, firstItemMs: Math.min(opts?.firstItemMs ?? JSONL_FIRST_ITEM_MS, totalMs) },
          async (res, touch) => {
            let usage: LlmUsage = { ...EMPTY_USAGE }
            let pending = ''
            const accept = (line: string) => {
              const item = parseJsonlLine(line, schema)
              if (!item) return
              touch()
              seen += 1
              // 重试时，前一次已经交出去的条数直接跳过。
              if (seen <= delivered) return
              delivered += 1
              onItem(item)
            }
            await readSse(res, (chunk) => {
              const delta = chunk.choices?.[0]?.delta?.content
              if (delta) {
                pending += delta
                const taken = takeCompleteLines(pending)
                pending = taken.rest
                for (const line of taken.lines) accept(line)
              }
              if (chunk.usage) usage = parseUsage(chunk.usage)
            })
            if (pending.trim()) accept(pending.trim())
            return usage
          },
        )
      })
    },
  }
}
