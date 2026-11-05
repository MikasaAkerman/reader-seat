import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createLlmClient } from '@/core/llm'

const pingSchema = z.object({ ok: z.literal(true) })

const deepseek = { baseUrl: 'https://api.deepseek.com', apiKey: 'test-key', model: 'deepseek-chat', retryDelayMs: 0 }
const openrouter = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'test-key', model: 'openrouter/free', retryDelayMs: 0 }

/** 先吐出一段，下一次读取时断开。 */
function brokenStream(first: string): ReadableStream<Uint8Array> {
  let sent = false
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.error(new TypeError('network lost'))
        return
      }
      sent = true
      controller.enqueue(new TextEncoder().encode(first))
    },
  })
}

function bodyOf(mock: typeof fetch, call: number): Record<string, unknown> {
  const calls = (mock as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls
  return JSON.parse(String(calls[call]?.[1]?.body)) as Record<string, unknown>
}

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

  it('does not send a reasoning field to DeepSeek and reads reasoning tokens', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '```json\n{"ok":true}\n```' } }],
            usage: { prompt_tokens: 5, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 4 } },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch
    const client = createLlmClient({ ...deepseek, fetch: fetchMock })
    const { data, usage } = await client.chatJson([{ role: 'user', content: 'json' }], pingSchema)
    expect(data.ok).toBe(true)
    expect(usage.reasoningTokens).toBe(4)
    const body = bodyOf(fetchMock, 0)
    expect(body.reasoning).toBeUndefined()
    expect(body.max_tokens).toBe(2000)
  })

  it('turns reasoning off on OpenRouter and allows low effort when asked', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }),
    ) as unknown as typeof fetch
    const client = createLlmClient({ ...openrouter, fetch: fetchMock })
    await client.chatJson([{ role: 'user', content: 'json' }], pingSchema)
    await client.chatJson([{ role: 'user', content: 'json' }], pingSchema, { reasoning: 'low' })
    expect(bodyOf(fetchMock, 0).reasoning).toEqual({ effort: 'none' })
    expect(bodyOf(fetchMock, 1).reasoning).toEqual({ effort: 'low' })
    await client.chatJson([{ role: 'user', content: 'json' }], pingSchema, { reasoning: 'high' })
    await client.chatJson([{ role: 'user', content: 'json' }], pingSchema, { reasoning: 'medium' })
    expect(bodyOf(fetchMock, 2).reasoning).toEqual({ effort: 'high' })
    expect(bodyOf(fetchMock, 3).reasoning).toEqual({ effort: 'medium' })
  })

  it('drops the reasoning field when the model insists on thinking', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { reasoning?: unknown }
      if (body.reasoning) return new Response('Reasoning is mandatory for this endpoint', { status: 400 })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const client = createLlmClient({ ...openrouter, fetch: fetchMock })
    const { data } = await client.chatJson([{ role: 'user', content: 'json' }], pingSchema)
    expect(data.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetchMock, 1).reasoning).toBeUndefined()
  })

  it('raises max_tokens once when the answer is cut off', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { max_tokens: number }
      const done = body.max_tokens > 1000
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: done ? '{"ok":true}' : '{"ok":' }, finish_reason: done ? 'stop' : 'length' }],
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const client = createLlmClient({ ...openrouter, fetch: fetchMock })
    const { data } = await client.chatJson([{ role: 'user', content: 'json' }], pingSchema, { maxTokens: 1000 })
    expect(data.ok).toBe(true)
    expect(bodyOf(fetchMock, 1).max_tokens).toBe(1500)
    expect(bodyOf(fetchMock, 1).reasoning).toEqual({ effort: 'none' })
  })

  it('does not retry an auth error but retries a server error', async () => {
    const unauthorized = vi.fn(async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch
    await expect(
      createLlmClient({ ...deepseek, fetch: unauthorized }).chatJson([{ role: 'user', content: 'json' }], pingSchema),
    ).rejects.toThrow(/401/)
    expect(unauthorized).toHaveBeenCalledTimes(1)

    let calls = 0
    const flaky = vi.fn(async () => {
      calls += 1
      if (calls === 1) return new Response('busy', { status: 503 })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const { data } = await createLlmClient({ ...deepseek, fetch: flaky }).chatJson(
      [{ role: 'user', content: 'json' }],
      pingSchema,
    )
    expect(data.ok).toBe(true)
    expect(flaky).toHaveBeenCalledTimes(2)
  })

  it('times out while the body is still being read', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
        },
      })
      return new Response(body, { status: 200 })
    }) as unknown as typeof fetch
    const client = createLlmClient({ ...deepseek, fetch: fetchMock })
    await expect(
      client.chatJson([{ role: 'user', content: 'json' }], pingSchema, { timeoutMs: 20 }),
    ).rejects.toThrow(/超时/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not hand out the same JSONL item twice when a stream is retried', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return new Response(brokenStream('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}\\n"}}]}\n\n'), {
          status: 200,
        })
      }
      const sse = [
        'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}\\n{\\"ok\\":true}\\n"}}]}\n\n',
        'data: [DONE]\n\n',
      ].join('')
      return new Response(sse, { status: 200 })
    }) as unknown as typeof fetch
    const client = createLlmClient({ ...deepseek, fetch: fetchMock })
    const items: boolean[] = []
    await client.chatJsonl([{ role: 'user', content: 'hi' }], pingSchema, (item) => items.push(item.ok))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(items).toEqual([true, true])
  })

  it('does not retry a text stream after it has shown something', async () => {
    const fetchMock = vi.fn(async () => new Response(brokenStream('data: {"choices":[{"delta":{"content":"半句"}}]}\n\n'), { status: 200 })) as unknown as typeof fetch
    const client = createLlmClient({ ...deepseek, fetch: fetchMock })
    let text = ''
    await expect(client.chatStream([{ role: 'user', content: 'hi' }], (delta) => (text += delta))).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(text).toBe('半句')
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
