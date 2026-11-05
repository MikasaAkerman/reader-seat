import { samplePassersby } from '../personas'
import { emptyDropped, retrievePassages, verifyQuote, type DroppedCounts, type Passage } from '../quality'
import type { ObservationKind, ResidentPersona, TextBlock } from '../types'
import { pidToIndex, type ObservationDraft, type ObserveParagraph, type ObserveResult } from './schema'

export const KIND_ROLE: Record<ObservationKind, string> = {
  动机: '头回读',
  疑问: '头回读',
  修辞: '课代表',
  结构: '课代表',
  细节: '课代表',
  矛盾: '毒舌',
  伏笔: '老书虫',
  呼应: '考据癖',
}

export function maxPicks(paragraphCount: number): number {
  return Math.min(5, Math.max(1, Math.round(paragraphCount * 0.35)))
}

export interface AssignedSlot {
  cid: string
  oid: string
  pid: string
  paragraphIndex: number
  kind: ObservationKind
  quote: string
  point: string
  echoText?: string
  authorType: 'resident' | 'passerby'
  readerRole: string
  displayName: string
  voice: string
  score: number
  hot: boolean
}

export interface AssignResult {
  slots: AssignedSlot[]
  paragraphs: ObserveParagraph[]
  hotPids: string[]
  newEntities: string[]
  dropped: DroppedCounts
}

function safeIndex(pid: string): number | null {
  try {
    return pidToIndex(pid)
  } catch {
    return null
  }
}

function similarAngle(point: string, recent: string[]): boolean {
  const needle = point.replace(/[\p{P}\p{S}\s]/gu, '')
  if (needle.length < 4) return false
  return recent.some((item) => {
    const other = item.replace(/[\p{P}\p{S}\s]/gu, '')
    if (other.length < 4) return false
    return other.includes(needle) || needle.includes(other)
  })
}

function wantedCount(score: number, hot: boolean): number {
  if (hot) return 6
  if (score >= 2) return 3
  if (score >= 1) return 1
  return 0
}

function personaByRole(lineup: ResidentPersona[], role: string): ResidentPersona | undefined {
  return lineup.find((persona) => persona.role === role)
}

export function formatSlot(slot: AssignedSlot): string {
  const who =
    slot.authorType === 'resident'
      ? `常驻 ${slot.readerRole}（${slot.displayName}）口吻：${slot.voice}`
      : `路人 ${slot.displayName} 口吻：${slot.voice}`
  const echo = slot.echoText ? `前文原文：${slot.echoText}` : ''
  return [slot.cid, slot.pid, who, `观察（${slot.kind}）：${slot.point}`, `引文：${slot.quote}`, echo]
    .filter(Boolean)
    .join(' | ')
}

export function assignObservations(input: {
  result: ObserveResult
  block: TextBlock
  lineup: ResidentPersona[]
  recentAngles: string[]
  passages: Passage[]
  seed: string
  hotLimit?: number
}): AssignResult {
  const dropped = emptyDropped()
  const hotLimit = input.hotLimit ?? 2
  const picks = maxPicks(input.block.paragraphs.length)
  const ranked = [...input.result.paragraphs]
    .filter((paragraph) => safeIndex(paragraph.pid) !== null)
    .sort((a, b) => b.score - a.score || safeIndex(a.pid)! - safeIndex(b.pid)!)
    .slice(0, picks)

  const requestedHot = new Set(
    [...input.result.hot_pids, ...ranked.filter((item) => item.score === 3 || item.prediction_hits.length > 0).map((item) => item.pid)],
  )
  const hotPids: string[] = []
  const slots: AssignedSlot[] = []
  const keptParagraphs: ObserveParagraph[] = []
  let lastResident = ''
  let cid = 1

  for (const paragraph of ranked) {
    const index = safeIndex(paragraph.pid)
    if (index === null) continue
    const hot = requestedHot.has(paragraph.pid) && hotPids.length < hotLimit
    const observations: ObservationDraft[] = []
    for (const item of paragraph.observations) {
      if (observations.length >= wantedCount(hot ? 3 : paragraph.score, hot)) break
      if (!verifyQuote(item.quote, input.block.paragraphs, index)) {
        dropped.quote += 1
        continue
      }
      if (similarAngle(item.point, input.recentAngles)) {
        dropped.duplicate += 1
        continue
      }
      let echoText: string | undefined
      if (item.kind === '呼应') {
        const query = item.echo_query?.trim() || item.point
        const found = retrievePassages(query, input.passages, 1)
        if (found.length === 0) {
          dropped.quote += 1
          continue
        }
        echoText = found[0]?.chapterTitle ? `《${found[0].chapterTitle}》${found[0].text}` : found[0]?.text
      }
      observations.push({ ...item, echo_query: echoText ? item.echo_query : item.echo_query })
      const residentsHere = slots.filter((slot) => slot.pid === paragraph.pid && slot.authorType === 'resident')
      const preferred = KIND_ROLE[item.kind]
      const persona =
        personaByRole(input.lineup, preferred) &&
        residentsHere.length < 2 &&
        lastResident !== preferred
          ? personaByRole(input.lineup, preferred)
          : residentsHere.length < 2
            ? input.lineup.find((person) => person.role !== lastResident && !residentsHere.some((slot) => slot.readerRole === person.role))
            : undefined
      if (persona) {
        lastResident = persona.role
        slots.push({
          cid: `c${cid}`,
          oid: item.oid || `o${cid}`,
          pid: paragraph.pid,
          paragraphIndex: index,
          kind: item.kind,
          quote: item.quote,
          point: item.point,
          echoText,
          authorType: 'resident',
          readerRole: persona.role,
          displayName: persona.displayName,
          voice: persona.voice,
          score: hot ? 3 : paragraph.score,
          hot,
        })
      } else {
        const passerby = samplePassersby(`${input.seed}:${paragraph.pid}:${cid}`, 1)[0]
        slots.push({
          cid: `c${cid}`,
          oid: item.oid || `o${cid}`,
          pid: paragraph.pid,
          paragraphIndex: index,
          kind: item.kind,
          quote: item.quote,
          point: item.point,
          echoText,
          authorType: 'passerby',
          readerRole: '',
          displayName: passerby?.displayName || '路人',
          voice: passerby ? passerby.sampledDims.join('、') : '简短口语',
          score: hot ? 3 : paragraph.score,
          hot,
        })
      }
      cid += 1
    }
    if (observations.length === 0) continue
    if (hot) hotPids.push(paragraph.pid)
    keptParagraphs.push({
      ...paragraph,
      score: hot ? 3 : paragraph.score,
      observations,
    })
  }

  return {
    slots,
    paragraphs: keptParagraphs,
    hotPids,
    newEntities: input.result.new_entities,
    dropped,
  }
}
