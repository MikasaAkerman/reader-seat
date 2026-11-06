import { describe, expect, it, vi } from 'vitest'
import { detectProvider, endpointUrl, filterModelIds, listModels, parseModelIds, resolveProviderId } from '@/core/llm'

describe('llm providers', () => {
  it('recognizes preset hosts and leaves unknown addresses custom', () => {
    expect(detectProvider('https://api.deepseek.com').id).toBe('deepseek')
    expect(detectProvider('https://openrouter.ai/api/v1/').id).toBe('openrouter')
    expect(detectProvider('https://generativelanguage.googleapis.com/v1beta').protocol).toBe('gemini')
    expect(detectProvider('https://example.com/v1').id).toBe('custom')
    expect(resolveProviderId(undefined, 'https://api.moonshot.cn/v1')).toBe('moonshot')
    expect(resolveProviderId('custom', 'https://api.deepseek.com')).toBe('custom')
  })

  it('does not append a second version segment', () => {
    expect(endpointUrl('https://api.deepseek.com', '/v1/models')).toBe('https://api.deepseek.com/v1/models')
    expect(endpointUrl('https://api.openai.com/v1', '/v1/models')).toBe('https://api.openai.com/v1/models')
    expect(endpointUrl('https://open.bigmodel.cn/api/paas/v4', '/v1/chat/completions')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    )
    expect(endpointUrl('https://generativelanguage.googleapis.com/v1beta', '/v1/models')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models',
    )
    expect(endpointUrl('https://api.anthropic.com', '/v1/models')).toBe('https://api.anthropic.com/v1/models')
  })

  it('parses model ids from the three list shapes', () => {
    expect(parseModelIds('openai', { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })).toEqual([
      'deepseek-chat',
      'deepseek-reasoner',
    ])
    expect(parseModelIds('anthropic', { data: [{ id: 'claude-sonnet-4-5' }] })).toEqual(['claude-sonnet-4-5'])
    expect(parseModelIds('gemini', { models: [{ name: 'models/gemini-2.5-pro' }] })).toEqual(['gemini-2.5-pro'])
    expect(filterModelIds(['gemini-2.5-pro', 'gemini-2.5-flash'], 'flash')).toEqual(['gemini-2.5-flash'])
  })

  it('returns an empty list on failure and does not call the network without a key', async () => {
    const idle = vi.fn() as unknown as typeof fetch
    const missing = await listModels({ baseUrl: 'https://api.openai.com/v1', apiKey: '  ', fetch: idle })
    expect(idle).not.toHaveBeenCalled()
    expect(missing.models).toEqual([])
    expect(missing.error).toMatch(/API Key/)

    const failed = vi.fn(async () => new Response('missing', { status: 404 })) as unknown as typeof fetch
    const result = await listModels({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-key',
      fetch: failed,
    })
    expect(result.models).toEqual([])
    expect(result.error).toMatch(/404/)
    expect(failed).toHaveBeenCalledWith('https://api.deepseek.com/v1/models', expect.anything())

    const empty = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch
    const blank = await listModels({ baseUrl: 'https://api.openai.com/v1', apiKey: 'test-key', fetch: empty })
    expect(blank).toEqual({ models: [] })
  })
})
