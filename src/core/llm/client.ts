import { createParser, type EventSourceMessage } from 'eventsource-parser'
import type { ZodType } from 'zod'
import { authHeaders, detectProvider, endpointUrl, type LlmProtocol } from './providers'
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
  readonly formatRejected: boolean
  readonly streamOptionsRejected: boolean

  constructor(
    message: string,
    init: {
      retryable: boolean
      status?: number
      truncated?: boolean
      reasoningRejected?: boolean
      formatRejected?: boolean
      streamOptionsRejected?: boolean
    },
  ) {
    super(message)
    this.name = 'LlmError'
    this.retryable = init.retryable
    this.status = init.status
    this.truncated = init.truncated === true
    this.reasoningRejected = init.reasoningRejected === true
    this.formatRejected = init.formatRejected === true
    this.streamOptionsRejected = init.streamOptionsRejected === true
  }
}

interface Attempt {
  maxTokens: number
  sendReasoning: boolean
  sendJsonFormat: boolean
  sendStreamUsage: boolean
}

interface Timing {
  totalMs: number
  /** 流式 JSONL：第一条结果出现前的等待上限 */
  firstItemMs?: number
}

interface TextTurn {
  role: 'user' | 'assistant'
  content: string
}

const JSONL_FIRST_ITEM_MS = 20_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function presentNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseUsage(raw: unknown): LlmUsage {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_USAGE }
  const usage = raw as Record<string, unknown>
  const completion = usage.completion_tokens_details as Record<string, unknown> | undefined
  const prompt = usage.prompt_tokens_details as Record<string, unknown> | undefined
  const promptTokens = presentNumber(usage, 'prompt_tokens') ?? presentNumber(usage, 'input_tokens') ?? presentNumber(usage, 'promptTokenCount')
  const completionTokens =
    presentNumber(usage, 'completion_tokens') ?? presentNumber(usage, 'output_tokens') ?? presentNumber(usage, 'candidatesTokenCount')
  const cacheHitTokens =
    presentNumber(usage, 'prompt_cache_hit_tokens') ??
    (prompt ? presentNumber(prompt, 'cached_tokens') : undefined) ??
    presentNumber(usage, 'cache_read_input_tokens') ??
    presentNumber(usage, 'cachedContentTokenCount')
  const reasoningTokens = (completion ? presentNumber(completion, 'reasoning_tokens') : undefined) ?? presentNumber(usage, 'thoughtsTokenCount')
  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    cacheHitTokens: cacheHitTokens ?? 0,
    reasoningTokens: reasoningTokens ?? 0,
  }
}

function mergeUsage(current: LlmUsage, next: LlmUsage): LlmUsage {
  return {
    promptTokens: next.promptTokens || current.promptTokens,
    completionTokens: next.completionTokens || current.completionTokens,
    cacheHitTokens: next.cacheHitTokens || current.cacheHitTokens,
    reasoningTokens: next.reasoningTokens || current.reasoningTokens,
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

function openAiReasoning(baseUrl: string, model: string, mode: ReasoningMode): Record<string, unknown> {
  if (/openrouter\.ai/i.test(baseUrl)) return { reasoning: { effort: mode === 'off' ? 'none' : mode } }
  if (/api\.openai\.com/i.test(baseUrl) && /^(o\d|gpt-5)/i.test(model) && mode !== 'off') {
    return { reasoning_effort: mode }
  }
  return {}
}

function splitMessages(messages: ChatMessage[]): { system: string; turns: TextTurn[] } {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
  const turns: TextTurn[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n\n${message.content}`
    else turns.push({ role, content: message.content })
  }
  return { system, turns }
}

function geminiModel(model: string): string {
  return encodeURIComponent(model.replace(/^models\//, ''))
}

export function estimateCost(usage: LlmUsage, pricing: Pricing): number {
  const miss = Math.max(0, usage.promptTokens - usage.cacheHitTokens)
  return (
    (usage.cacheHitTokens / 1_000_000) * pricing.inputHitPerMTok +
    (miss / 1_000_000) * pricing.inputMissPerMTok +
    (usage.completionTokens / 1_000_000) * pricing.outputPerMTok
  )
}

async function readSse(res: Response, onData: (data: unknown) => void): Promise<void> {
  if (!res.body) throw new LlmError('LLM stream response has no body', { retryable: true })
  const parser = createParser({
    onEvent(event: EventSourceMessage) {
      if (!event.data || event.data === '[DONE]') return
      try {
        onData(JSON.parse(event.data) as unknown)
      } catch {
        // 跳过不是 JSON 的心跳。
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
}

function textOf(protocol: LlmProtocol, data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  if (protocol === 'anthropic') {
    if (record.type !== 'content_block_delta') return ''
    const delta = record.delta as { text?: string } | undefined
    return delta?.text ?? ''
  }
  if (protocol === 'gemini') {
    const candidates = record.candidates as Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> | undefined
    const parts = candidates?.[0]?.content?.parts ?? []
    const visible = parts.filter((part) => !part.thought)
    return (visible.length ? visible : parts).map((part) => part.text ?? '').join('')
  }
  const choices = record.choices as Array<{ delta?: { content?: string } }> | undefined
  return choices?.[0]?.delta?.content ?? ''
}

function usageOf(protocol: LlmProtocol, data: unknown): LlmUsage | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  if (protocol === 'anthropic') {
    if (record.type === 'message_start') {
      const message = record.message as { usage?: unknown } | undefined
      return message?.usage ? parseUsage(message.usage) : null
    }
    if (record.type === 'message_delta' && record.usage) return parseUsage(record.usage)
    return null
  }
  if (protocol === 'gemini') return record.usageMetadata ? parseUsage(record.usageMetadata) : null
  return record.usage ? parseUsage(record.usage) : null
}

function readCompletion(protocol: LlmProtocol, json: Record<string, unknown>): { content: string; truncated: boolean; usage: LlmUsage } {
  if (protocol === 'anthropic') {
    const blocks = (json.content as Array<{ text?: string }> | undefined) ?? []
    return {
      content: blocks.map((block) => block.text ?? '').join(''),
      truncated: json.stop_reason === 'max_tokens',
      usage: parseUsage(json.usage),
    }
  }
  if (protocol === 'gemini') {
    const candidates = json.candidates as Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }> | undefined
    const parts = candidates?.[0]?.content?.parts ?? []
    const visible = parts.filter((part) => !part.thought)
    return {
      content: (visible.length ? visible : parts).map((part) => part.text ?? '').join(''),
      truncated: candidates?.[0]?.finishReason === 'MAX_TOKENS',
      usage: parseUsage(json.usageMetadata),
    }
  }
  const choices = json.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined
  return {
    content: choices?.[0]?.message?.content ?? '',
    truncated: choices?.[0]?.finish_reason === 'length',
    usage: parseUsage(json.usage),
  }
}

export function createLlmClient(config: LlmConfig): LlmClient {
  const { baseUrl, apiKey, model, fetch: fetchFn } = config
  const protocol = config.protocol ?? detectProvider(baseUrl).protocol
  const retryDelayMs = config.retryDelayMs ?? 2000
  const headers = authHeaders(protocol, apiKey)

  function wantsReasoning(mode: ReasoningMode): boolean {
    if (protocol === 'gemini') return true
    if (protocol === 'anthropic') return mode !== 'off'
    return Object.keys(openAiReasoning(baseUrl, model, mode)).length > 0
  }

  function firstAttempt(opts: CallOptions | undefined, fallbackMaxTokens: number, stream: boolean): Attempt {
    return {
      maxTokens: opts?.maxTokens ?? fallbackMaxTokens,
      sendReasoning: wantsReasoning(opts?.reasoning ?? 'off'),
      sendJsonFormat: !stream && protocol !== 'anthropic',
      sendStreamUsage: stream && protocol === 'openai',
    }
  }

  /** 截断时放大一次预算；服务商不认推理、JSON 模式或流式用量时去掉对应字段；其余可重试错误只重试一次。 */
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
          if (err.formatRejected && attempt.sendJsonFormat) {
            attempt = { ...attempt, sendJsonFormat: false }
            continue
          }
          if (err.streamOptionsRejected && attempt.sendStreamUsage) {
            attempt = { ...attempt, sendStreamUsage: false }
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

  function requestBody(
    messages: ChatMessage[],
    stream: boolean,
    attempt: Attempt,
    mode: ReasoningMode,
  ): { url: string; body: Record<string, unknown> } {
    if (protocol === 'anthropic') {
      const { system, turns } = splitMessages(messages)
      return {
        url: endpointUrl(baseUrl, '/v1/messages'),
        body: {
          model,
          max_tokens: attempt.maxTokens,
          stream,
          ...(system ? { system } : {}),
          messages: turns,
          ...(attempt.sendReasoning && mode !== 'off' ? { output_config: { effort: mode } } : {}),
        },
      }
    }
    if (protocol === 'gemini') {
      const { system, turns } = splitMessages(messages)
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: attempt.maxTokens,
        ...(attempt.sendJsonFormat ? { responseMimeType: 'application/json' } : {}),
        ...(attempt.sendReasoning
          ? { thinkingConfig: mode === 'off' ? { thinkingBudget: 0 } : { thinkingLevel: mode } }
          : {}),
      }
      const action = stream ? 'streamGenerateContent' : 'generateContent'
      return {
        url: `${endpointUrl(baseUrl, `/v1/models/${geminiModel(model)}:${action}`)}${stream ? '?alt=sse' : ''}`,
        body: {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: turns.map((turn) => ({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: turn.content }],
          })),
          generationConfig,
        },
      }
    }
    return {
      url: endpointUrl(baseUrl, '/v1/chat/completions'),
      body: {
        model,
        messages,
        stream,
        max_tokens: attempt.maxTokens,
        ...(attempt.sendReasoning ? openAiReasoning(baseUrl, model, mode) : {}),
        ...(attempt.sendJsonFormat ? { response_format: { type: 'json_object' } } : {}),
        ...(attempt.sendStreamUsage ? { stream_options: { include_usage: true } } : {}),
      },
    }
  }

  function rejectFlags(status: number, text: string, attempt: Attempt) {
    const bad = status === 400
    return {
      reasoningRejected: bad && attempt.sendReasoning && /reason|thinking|output_config|\beffort\b/i.test(text),
      formatRejected: bad && attempt.sendJsonFormat && /response_format|responseMimeType|response_mime|json_object/i.test(text),
      streamOptionsRejected: bad && attempt.sendStreamUsage && /stream_options|include_usage/i.test(text),
    }
  }

  /** 超时覆盖整个请求，包括读响应体。 */
  async function request<T>(
    messages: ChatMessage[],
    stream: boolean,
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
    const prepared = requestBody(messages, stream, attempt, opts?.reasoning ?? 'off')

    try {
      const res = await fetchFn(prepared.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(prepared.body),
        signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new LlmError(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`, {
          status: res.status,
          retryable: retryableStatus(res.status),
          ...rejectFlags(res.status, text, attempt),
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

  async function readText(res: Response, onText: (text: string) => void): Promise<LlmUsage> {
    let usage: LlmUsage = { ...EMPTY_USAGE }
    await readSse(res, (data) => {
      const text = textOf(protocol, data)
      if (text) onText(text)
      const next = usageOf(protocol, data)
      if (next) usage = mergeUsage(usage, next)
    })
    return usage
  }

  return {
    async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>, opts?: CallOptions) {
      return withRetry(firstAttempt(opts, 2000, false), (attempt) =>
        request(messages, false, attempt, opts, { totalMs: opts?.timeoutMs ?? 60_000 }, async (res) => {
          const json = (await res.json()) as Record<string, unknown>
          const { content, truncated, usage } = readCompletion(protocol, json)
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
          return { data, usage }
        }),
      )
    },

    async chatStream(messages: ChatMessage[], onDelta: (text: string) => void, opts?: CallOptions) {
      let emitted = false
      return withRetry(firstAttempt(opts, 800, true), async (attempt) => {
        try {
          return await request(
            messages,
            true,
            attempt,
            opts,
            { totalMs: opts?.timeoutMs ?? 60_000 },
            (res) =>
              readText(res, (text) => {
                emitted = true
                onDelta(text)
              }),
          )
        } catch (err) {
          if (emitted && !isAbort(err)) {
            throw new LlmError(err instanceof Error ? err.message : String(err), { retryable: false })
          }
          throw err
        }
      })
    },

    async chatJsonl<T>(messages: ChatMessage[], schema: ZodType<T>, onItem: (item: T) => void, opts?: CallOptions) {
      let delivered = 0
      const totalMs = opts?.timeoutMs ?? 60_000
      return withRetry(firstAttempt(opts, 800, true), (attempt) => {
        let seen = 0
        return request(
          messages,
          true,
          attempt,
          opts,
          { totalMs, firstItemMs: Math.min(opts?.firstItemMs ?? JSONL_FIRST_ITEM_MS, totalMs) },
          async (res, touch) => {
            let pending = ''
            const accept = (line: string) => {
              const item = parseJsonlLine(line, schema)
              if (!item) return
              touch()
              seen += 1
              if (seen <= delivered) return
              delivered += 1
              onItem(item)
            }
            const usage = await readText(res, (text) => {
              pending += text
              const taken = takeCompleteLines(pending)
              pending = taken.rest
              for (const line of taken.lines) accept(line)
            })
            if (pending.trim()) accept(pending.trim())
            return usage
          },
        )
      })
    },
  }
}
