import type { MemoryUpdates } from '../generation/schema'
import type { BookMemory } from '../types'

export function emptyMemory(bookId = 'phase0'): BookMemory {
  return {
    bookId,
    nicknames: [],
    predictions: [],
    debates: [],
    updatedAt: new Date(0).toISOString(),
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
        id: `pr_${predictions.length + 1}`,
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

  return { ...memory, nicknames, predictions, debates, updatedAt: at }
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
