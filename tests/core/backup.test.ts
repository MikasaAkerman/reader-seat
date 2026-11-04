import { describe, expect, it } from 'vitest'
import { buildBackup, parseBackup } from '@/core/export'

describe('backup json', () => {
  it('round-trips tables and rejects a foreign schema', () => {
    const json = buildBackup({ books: [{ id: 'b' }] }, { schemaVersion: 1, exportedAt: '2026-11-04T00:00:00.000Z' })
    expect(parseBackup(json).tables.books).toEqual([{ id: 'b' }])
    expect(() => parseBackup('{"meta":{"schemaVersion":2,"exportedAt":""},"tables":{}}')).toThrow(/无法读取/)
  })
})
