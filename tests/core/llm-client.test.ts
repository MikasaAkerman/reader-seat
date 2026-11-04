import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createLlmClient } from '@/core/llm'

const pingSchema = z.object({ ok: z.literal(true) })

describe('createLlmClient', () => {
  it('chatJson parses schema and usage', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            prompt_cache_hit_tokens: 1,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const client = createLlmClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      fetch: fetchMock,
    })

    const { data, usage } = await client.chatJson(
      [{ role: 'user', content: 'json {"ok":true}' }],
      pingSchema,
    )
    expect(data.ok).toBe(true)
    expect(usage.promptTokens).toBe(10)
    expect(usage.completionTokens).toBe(2)
    expect(usage.cacheHitTokens).toBe(1)
  })

  it('chatStream yields deltas from SSE', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"通"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n',
      'data: [DONE]\n\n',
    ].join('')

    const fetchMock = vi.fn(async () => {
      return new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof fetch

    const client = createLlmClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      fetch: fetchMock,
    })

    let text = ''
    const usage = await client.chatStream([{ role: 'user', content: 'hi' }], (d) => {
      text += d
    })
    expect(text).toBe('通')
    expect(usage.promptTokens).toBe(3)
    expect(usage.completionTokens).toBe(1)
  })
})
