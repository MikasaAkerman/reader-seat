import { describe, expect, it } from 'vitest'
import {
  applyMemoryUpdates,
  emptyMemory,
  mergeChapterSummary,
  mergeSynopsis,
  priorSummaryFrom,
  resolvePredictions,
  snapshotForPrompt,
} from '@/core/memory'
import { SYNOPSIS_MAX_CHARS } from '@/core/memory/apply'

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

  it('resolves predictions, reading negations first', () => {
    const memory = emptyMemory('book')
    memory.predictions = [
      { id: 'pr_1', by: '头回读', content: '这回能成', status: '待验证' },
      { id: 'pr_2', by: '毒舌', content: '他会回来', status: '待验证' },
    ]
    const resolved = resolvePredictions(memory.predictions, [
      { prediction_id: 'pr_1', result: '说中了' },
      { prediction_id: 'pr_2', result: '没有应验' },
    ])
    expect(resolved.map((item) => item.status)).toEqual(['应验', '打脸'])
  })

  it('gives predictions unique short ids', () => {
    const updates = {
      nicknames: [],
      predictions: [
        { by: '头回读', content: '一' },
        { by: '头回读', content: '二' },
      ],
      debates: [],
      resident_stance_changes: [],
      scenes: [],
    }
    const ids = applyMemoryUpdates(emptyMemory(), updates).predictions.map((item) => item.id)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(id).toMatch(/^pr_[a-z0-9]{1,5}$/)
  })

  it('puts pending predictions first and stays inside the snapshot budget', () => {
    const memory = emptyMemory('book')
    memory.nicknames = [{ character: '船主', nickname: '补丁帆', by: '毒舌' }]
    memory.predictions = [{ id: 'pr_1', by: '头回读', content: '这回能成', status: '待验证' }]
    memory.scenes = [{ label: '很长的名场面'.repeat(80) }]
    const snapshot = snapshotForPrompt(memory, 60)
    expect(snapshot.startsWith('待验证预测：pr_1')).toBe(true)
    expect(snapshot).toContain('外号：')
    expect(snapshot.length).toBeLessThanOrEqual(60)
  })

  it('keeps the last three chapter summaries and folds the older ones', () => {
    const chapters = [1, 2, 3, 4, 5].map((order) => ({ order, summary: `第${order}章` }))
    expect(priorSummaryFrom(chapters, 6)).toBe('第1章；第2章\n第3章\n第4章\n第5章')
    expect(priorSummaryFrom(chapters, 6, '主角离家。')).toBe('全书梗概：主角离家。\n第3章\n第4章\n第5章')
    expect(priorSummaryFrom(chapters, 3)).toBe('第1章\n第2章')
    expect(mergeChapterSummary('第1章', '第1章')).toBe('第1章')
    expect(mergeChapterSummary('旧', '新摘要')).toBe('新摘要')
  })

  it('caps the synopsis length and ignores an empty update', () => {
    expect(mergeSynopsis('旧梗概', '')).toBe('旧梗概')
    expect(mergeSynopsis('', '长'.repeat(SYNOPSIS_MAX_CHARS + 50))).toHaveLength(SYNOPSIS_MAX_CHARS)
  })
})
