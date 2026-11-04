import type { MemoryUpdates } from '../generation/schema'
import type { BookMemory, Prediction } from '../types'

export function emptyMemory(bookId = 'phase0'): BookMemory {
  return {
    bookId,
    nicknames: [],
    predictions: [],
    debates: [],
    scenes: [],
    stances: [],
    userStance: [],
    updatedAt: new Date(0).toISOString(),
  }
}

/** 预测 id 进 prompt，要短；删掉旧预测后也不能和留下的撞号。 */
export function predictionId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = `pr_${Math.random().toString(36).slice(2, 7)}`
    if (!taken.has(id)) return id
  }
}

export function applyMemoryUpdates(
  memory: BookMemory,
  updates: MemoryUpdates,
  at = new Date().toISOString(),
): BookMemory {
  const nicknames = [...memory.nicknames]
  for (const item of updates.nicknames) {
    const exists = nicknames.some(
      (n) => n.character === item.character && n.nickname === item.nickname,
    )
    if (!exists) nicknames.push(item)
  }

  const predictions = [...memory.predictions]
  for (const item of updates.predictions) {
    const exists = predictions.some((p) => p.by === item.by && p.content === item.content)
    if (!exists) {
      predictions.push({
        id: predictionId(new Set(predictions.map((p) => p.id))),
        by: item.by,
        content: item.content,
        status: '待验证',
      })
    }
  }

  const debates = [...memory.debates]
  for (const item of updates.debates) {
    if (!debates.some((d) => d.topic === item.topic)) debates.push(item)
  }

  const scenes = [...memory.scenes]
  for (const item of updates.scenes ?? []) {
    if (!scenes.some((scene) => scene.label === item.label)) scenes.push(item)
  }

  const stances = [...memory.stances]
  for (const item of updates.resident_stance_changes) {
    if (!item || typeof item !== 'object') continue
    const record = item as { role?: unknown; stance?: unknown }
    if (typeof record.role !== 'string' || typeof record.stance !== 'string') continue
    const index = stances.findIndex((stance) => stance.role === record.role)
    const next = { role: record.role, stance: record.stance }
    if (index >= 0) stances[index] = next
    else stances.push(next)
  }

  return { ...memory, nicknames, predictions, debates, scenes, stances, updatedAt: at }
}

export function noteUserStance(memory: BookMemory, text: string, at = new Date().toISOString()): BookMemory {
  const line = text.trim().slice(0, 80)
  if (!line || memory.userStance.includes(line)) return memory
  return { ...memory, userStance: [...memory.userStance, line].slice(-6), updatedAt: at }
}

export function resolvePredictions(
  predictions: Prediction[],
  hits: { prediction_id: string; result: string }[],
): Prediction[] {
  return predictions.map((prediction) => {
    const hit = hits.find((item) => item.prediction_id === prediction.id)
    if (!hit) return prediction
    const result = hit.result
    if (/打脸|推翻|说错|落空|(未|没有?|不)(能|曾)?(应验|成立|说中)/.test(result)) return { ...prediction, status: '打脸' }
    if (/应验|成立|说中/.test(result)) return { ...prediction, status: '应验' }
    return prediction
  })
}

export function mergeChapterSummary(existing: string | undefined, summary: string): string {
  const next = summary.trim()
  const prev = existing?.trim() ?? ''
  if (!next) return prev
  if (!prev || prev === next || next.includes(prev)) return next
  if (prev.includes(next)) return prev
  return next
}

export const SYNOPSIS_MAX_CHARS = 800

export function mergeSynopsis(previous: string, next: string): string {
  const text = next.trim()
  if (!text) return previous
  return text.slice(0, SYNOPSIS_MAX_CHARS)
}

/**
 * 前情 = 全书梗概 + 最近 3 章摘要。还没有梗概时，更早的章节每章取开头一句垫着。
 */
export function priorSummaryFrom(
  chapters: { order: number; summary?: string }[],
  beforeOrder: number,
  synopsis = '',
): string {
  const ready = chapters
    .filter((chapter) => chapter.order < beforeOrder && chapter.summary?.trim())
    .sort((a, b) => a.order - b.order)
  const recent = ready.slice(-3).map((chapter) => chapter.summary?.trim() ?? '')
  const head = synopsis.trim()
    ? `全书梗概：${synopsis.trim()}`
    : ready
        .slice(0, -3)
        .map((chapter) => (chapter.summary?.trim() ?? '').slice(0, 40))
        .join('；')
        .slice(-400)
  return [head, recent.join('\n')].filter(Boolean).join('\n')
}

const SNAPSHOT_NICKNAMES = 20

export function snapshotForPrompt(memory: BookMemory, budgetChars = 1500): string {
  const sections = [
    [
      '待验证预测',
      memory.predictions
        .filter((item) => item.status === '待验证')
        .map((item) => `${item.id} ${item.by}：${item.content}`)
        .join('；'),
    ],
    ['书友状态', memory.stances.map((item) => `${item.role}：${item.stance}`).join('；')],
    ['我的立场', memory.userStance.join('；')],
    [
      '外号',
      memory.nicknames
        .slice(-SNAPSHOT_NICKNAMES)
        .map((item) => `${item.character}=${item.nickname}（${item.by}）`)
        .join('；'),
    ],
    ['争议', memory.debates.map((item) => item.topic).join('；')],
    ['名场面', memory.scenes.map((item) => item.label).join('；')],
  ]
  let text = ''
  for (const [title, body] of sections) {
    if (!body) continue
    const label = title ?? ''
    const piece = `${label}：${body}\n`
    if (text.length + piece.length > budgetChars) {
      const room = budgetChars - text.length
      if (room > label.length + 1) text += piece.slice(0, room)
      break
    }
    text += piece
  }
  return text.trim() || '（空）'
}

export function formatMemoryForPrompt(memory: BookMemory): string {
  const nicknames =
    memory.nicknames.map((n) => `${n.character}=${n.nickname}（${n.by}）`).join('；') || '（无）'
  const pending = memory.predictions.filter((p) => p.status === '待验证')
  const predictions =
    pending.map((p) => `${p.id} ${p.by}：${p.content}`).join('；') || '（无）'
  const debates = memory.debates.map((d) => d.topic).join('；') || '（无）'
  return `外号：${nicknames}\n待验证预测：${predictions}\n争议：${debates}`
}
