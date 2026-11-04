import type { ZodType } from 'zod'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  fetch: typeof fetch
  /** 可重试错误之间的等待。测试里设成 0。 */
  retryDelayMs?: number
}

export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  /** 推理模型的思考 token，已经包含在 completionTokens 里。 */
  reasoningTokens: number
}

/** off：明确关掉思考（服务商支持时）；low：允许少量思考。 */
export type ReasoningMode = 'off' | 'low'

export interface CallOptions {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  signal?: AbortSignal
  responseFormat?: 'json_object' | 'text'
  reasoning?: ReasoningMode
  /** 流式 JSONL：第一条结果出现前的等待上限 */
  firstItemMs?: number
}

export interface LlmClient {
  chatJson<T>(
    messages: ChatMessage[],
    schema: ZodType<T>,
    opts?: CallOptions,
  ): Promise<{ data: T; usage: LlmUsage }>
  chatStream(
    messages: ChatMessage[],
    onDelta: (text: string) => void,
    opts?: CallOptions,
  ): Promise<LlmUsage>
  chatJsonl<T>(
    messages: ChatMessage[],
    schema: ZodType<T>,
    onItem: (item: T) => void,
    opts?: CallOptions,
  ): Promise<LlmUsage>
}

export interface Pricing {
  inputHitPerMTok: number
  inputMissPerMTok: number
  outputPerMTok: number
}

export const EMPTY_USAGE: LlmUsage = {
  promptTokens: 0,
  completionTokens: 0,
  cacheHitTokens: 0,
  reasoningTokens: 0,
}
