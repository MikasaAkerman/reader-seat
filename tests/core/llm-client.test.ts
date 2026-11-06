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

  it('retries without response_format when the endpoint rejects it', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { response_format?: unknown }
      if (body.response_format) return new Response('unsupported response_format', { status: 400 })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const client = createLlmClient({ ...deepseek, fetch: fetchMock })
    const { data } = await client.chatJson([{ role: 'user', content: 'json' }], pingSchema)
    expect(data.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetchMock, 1).response_format).toBeUndefined()
  })

  it('reads cached tokens from prompt_tokens_details', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 7 } },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const client = createLlmClient({ ...deepseek, fetch: fetchMock })
    const { usage } = await client.chatJson([{ role: 'user', content: 'json' }], pingSchema)
    expect(usage.cacheHitTokens).toBe(7)
  })

  it('sends reasoning_effort only for OpenAI o-series and gpt-5', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const openai = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      fetch: fetchMock,
      retryDelayMs: 0,
    }
    await createLlmClient({ ...openai, model: 'gpt-4o' }).chatJson([{ role: 'user', content: 'json' }], pingSchema, {
      reasoning: 'high',
    })
    expect(bodyOf(fetchMock, 0).reasoning_effort).toBeUndefined()
    await createLlmClient({ ...openai, model: 'gpt-5' }).chatJson([{ role: 'user', content: 'json' }], pingSchema, {
      reasoning: 'high',
    })
    expect(bodyOf(fetchMock, 1).reasoning_effort).toBe('high')
    await createLlmClient({ ...openai, model: 'o3' }).chatJson([{ role: 'user', content: 'json' }], pingSchema, {
      reasoning: 'off',
    })
    expect(bodyOf(fetchMock, 2).reasoning_effort).toBeUndefined()
  })

  it('posts Anthropic messages and folds streamed text deltas', async () => {
    const sse = [
      'event: message_start\n',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":4,"cache_read_input_tokens":1}}}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"通"}}\n\n',
      'event: message_delta\n',
      'data: {"type":"message_delta","usage":{"output_tokens":1}}\n\n',
    ].join('')
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean }
      if (body.stream) return new Response(sse, { status: 200 })
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"ok":true}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 8, output_tokens: 3, cache_read_input_tokens: 2 },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const client = createLlmClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-5',
      protocol: 'anthropic',
      fetch: fetchMock,
      retryDelayMs: 0,
    })
    const { usage } = await client.chatJson(
      [
        { role: 'system', content: '只返回 json' },
        { role: 'user', content: 'json' },
      ],
      pingSchema,
      { reasoning: 'high' },
    )
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.anything())
    const headers = headersOf(fetchMock, 0)
    expect(headers['x-api-key']).toBe('test-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const body = bodyOf(fetchMock, 0)
    expect(body.system).toBe('只返回 json')
    expect(body.messages).toEqual([{ role: 'user', content: 'json' }])
    expect(body.response_format).toBeUndefined()
    expect(body.output_config).toEqual({ effort: 'high' })
    expect(usage.promptTokens).toBe(8)
    expect(usage.cacheHitTokens).toBe(2)
    let text = ''
    const streamed = await client.chatStream([{ role: 'user', content: 'hi' }], (delta) => {
      text += delta
    })
    expect(text).toBe('通')
    expect(streamed.promptTokens).toBe(4)
    expect(streamed.completionTokens).toBe(1)
    expect(streamed.cacheHitTokens).toBe(1)
  })

  it('posts Gemini generateContent and reads a stream part', async () => {
    const sse = 'data: {"candidates":[{"content":{"parts":[{"text":"通"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":1}}\n\n'
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('streamGenerateContent')) return new Response(sse, { status: 200 })
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ thought: true, text: 'think' }, { text: '{"ok":true}' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 2, cachedContentTokenCount: 1, thoughtsTokenCount: 3 },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const client = createLlmClient({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'test-key',
      model: 'models/gemini-2.5-pro',
      protocol: 'gemini',
      fetch: fetchMock,
      retryDelayMs: 0,
    })
    const { data, usage } = await client.chatJson(
      [
        { role: 'system', content: '系统' },
        { role: 'user', content: 'json' },
        { role: 'assistant', content: '上一句' },
      ],
      pingSchema,
      { reasoning: 'low' },
    )
    expect(data.ok).toBe(true)
    expect(usage.promptTokens).toBe(6)
    expect(usage.cacheHitTokens).toBe(1)
    expect(usage.reasoningTokens).toBe(3)
    const url = urlOf(fetchMock, 0)
    expect(url).toContain('/models/gemini-2.5-pro:generateContent')
    expect(url).not.toContain('models%2F')
    expect(headersOf(fetchMock, 0)['x-goog-api-key']).toBe('test-key')
    const body = bodyOf(fetchMock, 0)
    const instruction = body.systemInstruction as { parts: Array<{ text: string }> }
    expect(instruction.parts[0]?.text).toBe('系统')
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'json' }] },
      { role: 'model', parts: [{ text: '上一句' }] },
    ])
    const config = body.generationConfig as { responseMimeType?: string; thinkingConfig?: { thinkingLevel?: string } }
    expect(config.responseMimeType).toBe('application/json')
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'low' })
    let text = ''
    await client.chatStream([{ role: 'user', content: 'hi' }], (delta) => {
      text += delta
    })
    expect(text).toBe('通')
    expect(urlOf(fetchMock, 1)).toContain('streamGenerateContent?alt=sse')
  })

  it('drops stream_options after a 400 and keeps zero usage', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"通"}}]}\n\ndata: [DONE]\n\n'
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { stream_options?: unknown }
      if (body.stream_options) return new Response('unknown stream_options', { status: 400 })
      return new Response(sse, { status: 200 })
    }) as unknown as typeof fetch
    const client = createLlmClient({ ...deepseek, fetch: fetchMock })
    let text = ''
    const usage = await client.chatStream([{ role: 'user', content: 'hi' }], (delta) => {
      text += delta
    })
    expect(text).toBe('通')
    expect(usage.promptTokens).toBe(0)
    expect(bodyOf(fetchMock, 1).stream_options).toBeUndefined()
  })

  it('uses the version already present in Zhipu and Qianfan URLs', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
    }) as unknown as typeof fetch
    await createLlmClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'test-key',
      model: 'glm-4',
      fetch: fetchMock,
      retryDelayMs: 0,
    }).chatJson([{ role: 'user', content: 'json' }], pingSchema)
    expect(urlOf(fetchMock, 0)).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions')
    expect(bodyOf(fetchMock, 0).reasoning).toBeUndefined()
  })

  it('omits temperature so the provider default is used', async () => {
    const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
    const kimi = vi.fn(async () => ok()) as unknown as typeof fetch
    await createLlmClient({
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'test-key',
      model: 'kimi-k3',
      fetch: kimi,
      retryDelayMs: 0,
    }).chatJson([{ role: 'user', content: 'json' }], pingSchema)
    expect(bodyOf(kimi, 0).temperature).toBeUndefined()

    const gemini = vi.fn(async () => {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    await createLlmClient({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'test-key',
      model: 'gemini-2.5-pro',
      protocol: 'gemini',
      fetch: gemini,
      retryDelayMs: 0,
    }).chatJson([{ role: 'user', content: 'json' }], pingSchema)
    const config = bodyOf(gemini, 0).generationConfig as { temperature?: number }
    expect(config.temperature).toBeUndefined()
  })
})

function headersOf(mock: typeof fetch, call: number): Record<string, string> {
  const calls = (mock as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls
  return (calls[call]?.[1]?.headers ?? {}) as Record<string, string>
}

function urlOf(mock: typeof fetch, call: number): string {
  const calls = (mock as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls
  return String(calls[call]?.[0])
}
