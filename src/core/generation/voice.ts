import type { LlmClient, LlmUsage } from '../llm'
import { buildVoicePrompt } from '../prompts'
import { EMPTY_USAGE } from '../llm/types'
import { addDropped, emptyDropped, gateComment, type DroppedCounts } from '../quality'
import type { TextBlock } from '../types'
import { formatSlot, type AssignedSlot } from './assign'
import { voiceLineSchema, type VoiceLine } from './schema'

export interface VoiceAccept {
  slot: AssignedSlot
  line: VoiceLine
}

export function voiceMaxTokens(slotCount: number): number {
  return Math.min(4000, 400 + 400 * Math.max(1, slotCount))
}

export function voiceAssignments(slots: AssignedSlot[]): string {
  return slots.map(formatSlot).join('\n')
}

async function runOnce(
  slots: AssignedSlot[],
  recentComments: string,
  rejected: string,
  client: LlmClient,
  block: TextBlock,
  knownEntities: Set<string>,
  newEntities: string[],
  extras: string[],
  corpus: string[],
  onAccept: (item: VoiceAccept) => void,
  signal?: AbortSignal,
): Promise<{ accepted: Map<string, VoiceAccept>; dropped: DroppedCounts; usage: LlmUsage; rejected: AssignedSlot[] }> {
  const byId = new Map(slots.map((slot) => [slot.cid, slot]))
  const accepted = new Map<string, VoiceAccept>()
  const dropped = emptyDropped()
  const failed: AssignedSlot[] = []
  const seen = new Set(corpus)
  const usage = await client.chatJsonl(
    buildVoicePrompt({
      assignments: voiceAssignments(slots),
      recentComments,
      rejected: rejected || undefined,
    }),
    voiceLineSchema,
    (line) => {
      const slot = byId.get(line.cid)
      if (!slot || accepted.has(line.cid)) return
      const quote = line.quote.trim() || slot.quote
      const gate = gateComment({
        text: line.text,
        quote,
        paragraphIndex: slot.paragraphIndex,
        block,
        knownEntities,
        newEntities,
        usesOutsidePlot: line.uses_outside_plot,
        corpus: [...seen],
        extras: [...extras, slot.quote],
      })
      if (!gate.ok) {
        dropped[gate.reason] += 1
        failed.push(slot)
        return
      }
      seen.add(line.text)
      const item = { slot, line: { ...line, quote } }
      accepted.set(line.cid, item)
      onAccept(item)
    },
    {
      maxTokens: voiceMaxTokens(slots.length),
      timeoutMs: 90_000,
      firstItemMs: 30_000,
      reasoning: 'off',
      signal,
    },
  )
  for (const slot of slots) {
    if (!accepted.has(slot.cid) && !failed.some((item) => item.cid === slot.cid)) failed.push(slot)
  }
  return { accepted, dropped, usage, rejected: failed }
}

export async function runVoice(
  slots: AssignedSlot[],
  recentComments: string,
  client: LlmClient,
  block: TextBlock,
  knownEntities: Set<string>,
  newEntities: string[],
  extras: string[],
  corpus: string[],
  onAccept: (item: VoiceAccept) => void,
  signal?: AbortSignal,
): Promise<{ accepted: VoiceAccept[]; dropped: DroppedCounts; usage: LlmUsage }> {
  if (slots.length === 0) return { accepted: [], dropped: emptyDropped(), usage: { ...EMPTY_USAGE } }
  const first = await runOnce(
    slots,
    recentComments,
    '',
    client,
    block,
    knownEntities,
    newEntities,
    extras,
    corpus,
    onAccept,
    signal,
  )
  if (first.rejected.length === 0 || signal?.aborted) {
    return { accepted: [...first.accepted.values()], dropped: first.dropped, usage: first.usage }
  }
  const retryNotes = first.rejected
    .map((slot) => `${slot.cid} 上次被拒。观察：${slot.point}。不要重复近期已经说过的话。`)
    .join('\n')
  const second = await runOnce(
    first.rejected,
    recentComments,
    retryNotes,
    client,
    block,
    knownEntities,
    newEntities,
    extras,
    [...corpus, ...[...first.accepted.values()].map((item) => item.line.text)],
    onAccept,
    signal,
  )
  return {
    accepted: [...first.accepted.values(), ...second.accepted.values()],
    dropped: addDropped(first.dropped, second.dropped),
    usage: {
      promptTokens: first.usage.promptTokens + second.usage.promptTokens,
      completionTokens: first.usage.completionTokens + second.usage.completionTokens,
      cacheHitTokens: first.usage.cacheHitTokens + second.usage.cacheHitTokens,
      reasoningTokens: first.usage.reasoningTokens + second.usage.reasoningTokens,
    },
  }
}
