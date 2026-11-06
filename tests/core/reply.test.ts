import { describe, expect, it } from 'vitest'
import { dialogueSpeaker, pickRepliers } from '@/core/personas'
import { DEFAULT_LINEUP } from '@/core/personas'

const lineup = DEFAULT_LINEUP.filter((persona) => persona.role !== '老书虫')

describe('pickRepliers', () => {
  it('mentions only the named resident', () => {
    const picked = pickRepliers({
      lineup,
      spoken: [{ authorType: 'resident', role: '毒舌', displayName: '毒舌' }],
      mention: '考据癖',
    })
    expect(picked.map((person) => person.role)).toEqual(['考据癖'])
  })

  it('keeps the replied resident and adds someone who has not spoken', () => {
    const picked = pickRepliers({
      lineup,
      spoken: [
        { authorType: 'resident', role: '毒舌', displayName: '毒舌' },
        { authorType: 'passerby', role: '', displayName: '路人甲' },
      ],
      replyTo: { authorType: 'resident', role: '毒舌', displayName: '毒舌' },
    })
    expect(picked[0]?.role).toBe('毒舌')
    expect(picked).toHaveLength(2)
    expect(picked.some((person) => person.role !== '毒舌')).toBe(true)
  })
})

describe('dialogueSpeaker', () => {
  it('answers as the replied friend', () => {
    const speaker = dialogueSpeaker(lineup, { authorType: 'resident', role: '毒舌', displayName: '毒舌' })
    expect(speaker.role).toBe('毒舌')
  })

  it('answers as the class representative when nobody was replied to', () => {
    const speaker = dialogueSpeaker(lineup)
    expect(speaker.role).toBe('课代表')
  })
})
