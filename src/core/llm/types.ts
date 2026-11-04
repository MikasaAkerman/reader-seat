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
}

export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
}

export interface CallOptions {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  signal?: AbortSignal
  responseFormat?: 'json_object' | 'text'
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
}
