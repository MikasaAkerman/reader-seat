import { describe, expect, it, vi } from 'vitest'
import { createLlmClient } from '@/core/llm'
import { runBackground } from '@/core/generation/background'
import { runDeep } from '@/core/generation/deep'
import { runDialogue } from '@/core/generation/live'
import type { TextBlock } from '@/core/types'

const block: TextBlock = { paragraphs: [{ index: 1, text: '他决定出远海，天还没亮。' }] }

function jsonResponse(payload: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function bodyOf(mock: typeof fetch, call: number): Record<string, unknown> {
  const calls = (mock as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls
  return JSON.parse(String(calls[call]?.[1]?.body)) as Record<string, unknown>
}

describe('dialogue and the three repairs', () => {
  it('asks the dialogue at high reasoning', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ text: '因为这一段写的是天还没亮。', uses_outside_plot: false }),
    ) as unknown as typeof fetch
    const client = createLlmClient({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'test-key',
      model: 'openrouter/free',
      fetch: fetchMock,
    })
    const generated = await runDialogue(
      {
        title: '样例',
        spoilerLevel: '严格',
        memorySnapshot: '（空）',
        priorSummary: '（无）',
        textUntilHere: 'p1 他决定出远海，天还没亮。',
        userText: '为什么天还没亮？',
        speakerName: '课代表',
        speakerVoice: '',
      },
      client,
      block,
      new Set(),
    )
    expect(bodyOf(fetchMock, 0).reasoning).toEqual({ effort: 'high' })
    expect(generated.text).toContain('天还没亮')
  })

  it('keeps background that is marked as outside the plot', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        text: '天还没亮常被用来写出发前的时辰，这里只是一条未核实的背景。',
        quote: '天还没亮',
        uses_outside_plot: true,
      }),
    ) as unknown as typeof fetch
    const client = createLlmClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      fetch: fetchMock,
    })
    const generated = await runBackground(
      { title: '样例', spoilerLevel: '严格', priorSummary: '（无）', textUntilHere: 'p1 他决定出远海，天还没亮。', pid: 'p1' },
      block,
      client,
      new Set(),
      [],
    )
    expect(generated.result?.text).toContain('未核实')
    expect(generated.result?.uses_outside_plot).toBe(true)
  })

  it('keeps the long comment when the optional background fails the gate', async () => {
    const essay = {
      thesis: {
        author: '课代表',
        title: '出发',
        body: '他决定出远海，可天还没亮。这一步写的是走，不是已经到了。',
        evidence: [
          { pid: 'p1', quote: '他决定出远海' },
          { pid: 'p1', quote: '天还没亮' },
        ],
      },
      rebuttal: { author: '毒舌', body: '天还没亮也可能只是随口一笔，不必上纲。' },
      background: '后文名在后面才会出现，这条背景不该留下。',
      question: '他为什么现在就走？',
    }
    const fetchMock = vi.fn(async () => jsonResponse(essay)) as unknown as typeof fetch
    const client = createLlmClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      fetch: fetchMock,
    })
    const generated = await runDeep(
      {
        title: '样例',
        spoilerLevel: '严格',
        memorySnapshot: '（空）',
        priorSummary: '（无）',
        sceneText: 'p1 他决定出远海，天还没亮。',
        earlierPassages: '',
        label: '出发',
        why: '读者要求',
        lens: '',
      },
      block,
      client,
      new Set(),
      ['后文名'],
    )
    expect(generated.result?.thesis.body).toContain('他决定出远海')
    expect(generated.result?.background).toBe('')
  })
})
