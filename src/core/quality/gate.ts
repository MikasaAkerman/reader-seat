import type { TextBlock } from '../types'
import { filterByEntityRule } from '../generation/entities'
import { quotesInTextPass, verifyQuote } from './quote'
import { isNearDuplicate } from './similarity'

export interface DroppedCounts {
  quote: number
  duplicate: number
  entity: number
  outside: number
  spoiler: number
}

export type DropReason = keyof DroppedCounts

export function emptyDropped(): DroppedCounts {
  return { quote: 0, duplicate: 0, entity: 0, outside: 0, spoiler: 0 }
}

export function addDropped(left: DroppedCounts, right: DroppedCounts): DroppedCounts {
  return {
    quote: left.quote + right.quote,
    duplicate: left.duplicate + right.duplicate,
    entity: left.entity + right.entity,
    outside: left.outside + right.outside,
    spoiler: left.spoiler + right.spoiler,
  }
}

export function markDropped(counts: DroppedCounts, reason: DropReason, n = 1): DroppedCounts {
  return { ...counts, [reason]: counts[reason] + n }
}

export function dropRate(counts: DroppedCounts, kept: number): number {
  const dropped = counts.quote + counts.duplicate + counts.entity + counts.outside + counts.spoiler
  const total = dropped + kept
  return total === 0 ? 0 : dropped / total
}

/**
 * 校验顺序：引文、实体、自报外部情节、去重。
 * 剧透二次校验由调用方在精修/长评之后单独做。
 */
export function gateComment(input: {
  text: string
  quote: string
  paragraphIndex: number
  block: TextBlock
  knownEntities: Set<string>
  newEntities: string[]
  usesOutsidePlot: boolean
  corpus: string[]
  extras?: string[]
}): { ok: true } | { ok: false; reason: DropReason } {
  const text = input.text.trim()
  if (!text) return { ok: false, reason: 'quote' }
  if (input.usesOutsidePlot) return { ok: false, reason: 'outside' }
  if (!verifyQuote(input.quote, input.block.paragraphs, input.paragraphIndex)) {
    return { ok: false, reason: 'quote' }
  }
  if (!quotesInTextPass(text, input.block.paragraphs, input.paragraphIndex)) {
    return { ok: false, reason: 'quote' }
  }
  const kept = filterByEntityRule(
    [{ paragraphIndex: input.paragraphIndex, text }],
    input.block,
    input.knownEntities,
    input.newEntities,
  )
  if (kept.length !== 1) return { ok: false, reason: 'entity' }
  const extras = [...(input.extras ?? []), input.quote]
  if (isNearDuplicate(text, input.corpus, 0.45, extras)) return { ok: false, reason: 'duplicate' }
  return { ok: true }
}
