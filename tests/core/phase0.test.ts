import { describe, expect, it } from 'vitest'
import { createLlmClient } from '@/core/llm'
import { generatePhase0 } from '@/core/generation/phase0'

describe('generatePhase0', () => {
  it('roughs a block and refines the hot paragraph', async () => {
    let calls = 0
    const fetchMock = (async () => {
      calls += 1
      const body =
        calls === 1
          ? {
              paragraphs: [
                {
                  pid: 'p1',
                  score: 1,
                  comments: [
                    {
                      author_type: 'resident',
                      reader_role: '头回读',
                      text: '天还没亮他就醒了',
                      reaction_type: '情绪反应',
                      stance: '赞同',
                      uses_outside_plot: false,
                    },
                  ],
                  background_note: null,
                  prediction_hits: [],
                },
                {
                  pid: 'p2',
                  score: 3,
                  comments: [],
                  prediction_hits: [],
                },
              ],
              new_entities: [],
            }
          : {
              pid: 'p2',
              threads: [
                {
                  root: {
                    author_type: 'resident',
                    reader_role: '头回读',
                    text: '他推门的样子像下了决心',
                    uses_outside_plot: false,
                  },
                  replies: [
                    {
                      author_type: 'resident',
                      reader_role: '毒舌',
                      reply_type: '反驳',
                      text: '决心个鬼，他只是睡不着',
                      uses_outside_plot: false,
                    },
                  ],
                },
              ],
              memory_updates: {
                nicknames: [{ character: '他', nickname: '失眠鬼', by: '毒舌' }],
                predictions: [{ by: '头回读', content: '出门就会碰上事' }],
                debates: [],
                resident_stance_changes: [],
              },
            }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(body) } }],
          usage: { prompt_tokens: 10, completion_tokens: 4, prompt_cache_hit_tokens: 0 },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const client = createLlmClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test',
      model: 'deepseek-chat',
      fetch: fetchMock,
    })
    const { document, memory } = await generatePhase0('天还没亮。\n\n他推开了门。', client, {
      title: '样例',
    })

    expect(calls).toBe(2)
    expect(document.paragraphs).toHaveLength(2)
    expect(document.paragraphs[0]?.comments[0]?.text).toContain('醒了')
    expect(document.paragraphs[1]?.score).toBe(3)
    expect(document.paragraphs[1]?.comments[0]?.replies).toHaveLength(1)
    expect(document.usage.promptTokens).toBe(20)
    expect(memory.nicknames[0]?.nickname).toBe('失眠鬼')
    expect(memory.predictions).toHaveLength(1)
  })
})
