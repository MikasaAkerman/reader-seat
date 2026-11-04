import { describe, expect, it } from 'vitest'
import {
  applyMemoryUpdates,
  emptyMemory,
  mergeChapterSummary,
  priorSummaryFrom,
  resolvePredictions,
  snapshotForPrompt,
} from '@/core/memory'

describe('applyMemoryUpdates', () => {
  it('appends nicknames and predictions without duplicates', () => {
    const updates = {
      nicknames: [{ character: '船主', nickname: '补丁帆', by: '毒舌' }],
      predictions: [{ by: '头回读', content: '这回能成' }],
      debates: [],
      resident_stance_changes: [],
      scenes: [],
    }
    const once = applyMemoryUpdates(emptyMemory(), updates, '2026-11-04T00:00:00.000Z')
    const twice = applyMemoryUpdates(once, updates, '2026-11-04T00:00:00.000Z')
    expect(twice.nicknames).toHaveLength(1)
    expect(twice.predictions).toHaveLength(1)
    expect(twice.predictions[0]?.status).toBe('待验证')
  })

  it('resolves a prediction and keeps nicknames inside the snapshot budget', () => {
    const memory = emptyMemory('book')
    memory.nicknames = [{ character: '船主', nickname: '补丁帆', by: '毒舌' }]
    memory.predictions = [{ id: 'pr_1', by: '头回读', content: '这回能成', status: '待验证' }]
    memory.scenes = [{ label: '很长的名场面'.repeat(80) }]
    const resolved = resolvePredictions(memory.predictions, [{ prediction_id: 'pr_1', result: '说中了' }])
    expect(resolved[0]?.status).toBe('应验')
    const snapshot = snapshotForPrompt(memory, 40)
    expect(snapshot.startsWith('外号：')).toBe(true)
    expect(snapshot.length).toBeLessThanOrEqual(40)
  })

  it('keeps the last three chapter summaries and folds the older ones', () => {
    const chapters = [1, 2, 3, 4, 5].map((order) => ({ order, summary: `第${order}章` }))
    expect(priorSummaryFrom(chapters, 6)).toBe('第1章第2章\n第3章\n第4章\n第5章')
    expect(mergeChapterSummary('第1章', '第1章')).toBe('第1章')
    expect(mergeChapterSummary('旧', '新摘要')).toBe('新摘要')
  })
})
