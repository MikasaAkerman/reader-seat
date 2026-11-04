import { describe, expect, it } from 'vitest'
import { refineResultSchema, roughResultSchema } from '@/core/generation/schema'

const roughSample = {
  paragraphs: [
    {
      pid: 'p3',
      score: 2,
      comments: [
        {
          author_type: 'resident',
          reader_role: '毒舌',
          text: '评论正文',
          reaction_type: '吐槽',
          stance: '质疑',
          uses_outside_plot: false,
        },
        {
          author_type: 'passerby',
          display_name: '路人昵称',
          sampled_dims: ['联想', '中立', '感性'],
          text: '评论正文',
          reaction_type: '联想',
          stance: '中立',
          uses_outside_plot: false,
        },
      ],
      background_note: null,
      prediction_hits: [],
    },
    {
      pid: 'p7',
      score: 3,
      comments: [],
      prediction_hits: [{ prediction_id: 'pr_12', result: '打脸' }],
    },
  ],
  new_entities: ['首次出现的人名或地名'],
}

const refineSample = {
  pid: 'p7',
  threads: [
    {
      root: {
        author_type: 'resident',
        reader_role: '头回读',
        text: '主楼正文',
        uses_outside_plot: false,
      },
      replies: [
        {
          author_type: 'resident',
          reader_role: '毒舌',
          reply_type: '反驳',
          text: '回复正文',
          uses_outside_plot: false,
        },
        {
          author_type: 'passerby',
          display_name: '路人昵称',
          reply_type: '接梗',
          text: '回复正文',
          uses_outside_plot: false,
        },
      ],
    },
  ],
  memory_updates: {
    nicknames: [{ character: '人物名', nickname: '外号', by: '毒舌' }],
    predictions: [{ by: '头回读', content: '预测内容' }],
    debates: [{ topic: '争议话题', sides: { 头回读: '立场', 毒舌: '立场' } }],
    resident_stance_changes: [],
  },
}

describe('generation schemas', () => {
  it('parses the rough-generation sample', () => {
    const data = roughResultSchema.parse(roughSample)
    expect(data.paragraphs[0]?.score).toBe(2)
    expect(data.paragraphs[1]?.prediction_hits[0]?.result).toBe('打脸')
    expect(data.new_entities).toEqual(['首次出现的人名或地名'])
  })

  it('parses the refine sample', () => {
    const data = refineResultSchema.parse(refineSample)
    expect(data.threads[0]?.replies).toHaveLength(2)
    expect(data.memory_updates.nicknames[0]?.nickname).toBe('外号')
  })

  it('fills omitted arrays and accepts a numeric score string', () => {
    const data = roughResultSchema.parse({
      paragraphs: [
        {
          pid: 'p1',
          score: '2',
          comments: [{ author_type: 'resident', reader_role: '毒舌', text: '还行' }],
        },
      ],
    })
    expect(data.paragraphs[0]?.score).toBe(2)
    expect(data.paragraphs[0]?.prediction_hits).toEqual([])
    expect(data.paragraphs[0]?.comments[0]?.reaction_type).toBe('')
    expect(data.paragraphs[0]?.comments[0]?.stance).toBe('')
    expect(data.paragraphs[0]?.comments[0]?.uses_outside_plot).toBe(false)
    expect(data.new_entities).toEqual([])
  })
})
