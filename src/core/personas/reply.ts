import type { AuthorType, ResidentPersona } from '../types'

export interface SpokenComment {
  authorType: AuthorType
  role: string
  displayName: string
}

export interface Replier {
  authorType: 'resident' | 'passerby'
  role: string
  displayName: string
  voice: string
}

function asResident(persona: ResidentPersona): Replier {
  return {
    authorType: 'resident',
    role: persona.role,
    displayName: persona.displayName,
    voice: persona.voice,
  }
}

/** 没有 @ 时的回答者：优先是被回复的那位书友，否则是课代表。 */
export function dialogueSpeaker(lineup: ResidentPersona[], replyTo?: SpokenComment): Replier {
  if (replyTo && replyTo.authorType !== 'user') {
    if (replyTo.authorType === 'resident') {
      const persona = lineup.find((item) => item.role === replyTo.role || item.displayName === replyTo.displayName)
      if (persona) return asResident(persona)
      return { authorType: 'resident', role: replyTo.role, displayName: replyTo.displayName, voice: '' }
    }
    return { authorType: 'passerby', role: replyTo.role, displayName: replyTo.displayName, voice: '' }
  }
  const host = lineup.find((persona) => persona.role === '课代表') ?? lineup[0]
  if (host) return asResident(host)
  return { authorType: 'resident', role: '课代表', displayName: '课代表', voice: '' }
}

export function pickRepliers(input: {
  lineup: ResidentPersona[]
  spoken: SpokenComment[]
  mention?: string
  replyTo?: SpokenComment
}): Replier[] {
  const picked: Replier[] = []
  const add = (person: Replier) => {
    if (picked.length >= 2) return
    if (picked.some((item) => item.role === person.role && item.displayName === person.displayName)) return
    picked.push(person)
  }
  const mentioned = input.mention
    ? input.lineup.find((persona) => persona.role === input.mention || persona.displayName === input.mention)
    : undefined
  if (mentioned) add(asResident(mentioned))

  if (input.replyTo && input.replyTo.authorType !== 'user') {
    if (input.replyTo.authorType === 'resident') {
      const persona = input.lineup.find((item) => item.role === input.replyTo?.role)
      add(
        persona
          ? asResident(persona)
          : {
              authorType: 'resident',
              role: input.replyTo.role,
              displayName: input.replyTo.displayName,
              voice: '',
            },
      )
    } else {
      add({
        authorType: 'passerby',
        role: input.replyTo.role,
        displayName: input.replyTo.displayName,
        voice: '',
      })
    }
  }

  if (!input.mention) {
    const spokenRoles = new Set(
      input.spoken.filter((item) => item.authorType === 'resident').map((item) => item.role),
    )
    const complement = input.lineup.find((persona) => !spokenRoles.has(persona.role))
    if (complement) add(asResident(complement))
    const passerby = input.spoken.find((item) => item.authorType === 'passerby')
    if (passerby) {
      add({
        authorType: 'passerby',
        role: passerby.role,
        displayName: passerby.displayName,
        voice: '',
      })
    }
    if (picked.length === 0 && input.lineup[0]) add(asResident(input.lineup[0]))
  }

  return picked
}
