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
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.anything(),
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

  it('chatJsonl emits each valid line and drops a broken one', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}\\n不是 json\\n"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}\\n"}}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ].join('')
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200 })) as unknown as typeof fetch
    const client = createLlmClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      fetch: fetchMock,
    })
    const items: boolean[] = []
    const usage = await client.chatJsonl([{ role: 'user', content: 'hi' }], pingSchema, (item) => {
      items.push(item.ok)
    })
    expect(items).toEqual([true, true])
    expect(usage.promptTokens).toBe(4)
  })

  it('retries a truncated response with reasoning turned off', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { reasoning?: { effort?: string } }
      const content = body.reasoning?.effort === 'none' ? '{"ok":true}' : '{"ok":'
      return new Response(
        JSON.stringify({
          choices: [{ message: { content }, finish_reason: body.reasoning?.effort === 'none' ? 'stop' : 'length' }],
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const client = createLlmClient({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'test-key',
      model: 'openrouter/free',
      fetch: fetchMock,
    })
    const { data } = await client.chatJson([{ role: 'user', content: 'json' }], pingSchema)
    expect(data.ok).toBe(true)
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { reasoning?: { effort?: string } }
    expect(second.reasoning?.effort).toBe('none')
  })

  it('does not duplicate /v1 when the base URL already includes it', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200,
      })
    }) as unknown as typeof fetch

    const client = createLlmClient({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'test-key',
      model: 'openrouter/free',
      fetch: fetchMock,
    })
    await client.chatJson([{ role: 'user', content: 'json' }], pingSchema)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.anything(),
    )
  })
})
