import { describe, expect, it } from 'vitest'
import { applyMemoryUpdates, emptyMemory } from '@/core/memory'

describe('applyMemoryUpdates', () => {
  it('appends nicknames and predictions without duplicates', () => {
    const updates = {
      nicknames: [{ character: '船主', nickname: '补丁帆', by: '毒舌' }],
      predictions: [{ by: '头回读', content: '这回能成' }],
      debates: [],
      resident_stance_changes: [],
    }
    const once = applyMemoryUpdates(emptyMemory(), updates, '2026-11-04T00:00:00.000Z')
    const twice = applyMemoryUpdates(once, updates, '2026-11-04T00:00:00.000Z')
    expect(twice.nicknames).toHaveLength(1)
    expect(twice.predictions).toHaveLength(1)
    expect(twice.predictions[0]?.status).toBe('待验证')
  })
})
