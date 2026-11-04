import { beforeEach, describe, expect, it } from 'vitest'
import { exportBackup, restoreBackup } from '@/db/repos/backup'
import { db } from '@/db/schema'

describe('backup repo', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('round-trips books without the file or the API key', async () => {
    await db.books.add({
      id: 'book',
      title: '巷口',
      author: '样例',
      translator: '',
      fingerprint: 'fp',
      spoilerLevel: '严格',
      unlockMode: '关闭',
      station: 1,
      lineup: {},
      createdAt: '2026-11-04T00:00:00.000Z',
      updatedAt: '2026-11-04T00:00:00.000Z',
    })
    await db.bookFiles.add({ bookId: 'book', bytes: new Uint8Array([1]) })
    await db.settings.bulkAdd([
      { key: 'llm.model', value: 'demo' },
      { key: 'secret:apiKey', value: 'hidden' },
    ])

    const json = await exportBackup()
    expect(json).not.toContain('hidden')
    expect(json).not.toContain('bookFiles')

    await db.books.update('book', { title: '被覆盖' })
    await db.settings.put({ key: 'llm.model', value: 'changed' })
    await restoreBackup(json)

    expect(await db.books.get('book')).toMatchObject({ title: '巷口', fileMissing: false })
    expect(await db.bookFiles.get('book')).toBeTruthy()
    expect(await db.settings.get('llm.model')).toMatchObject({ value: 'demo' })
    expect(await db.settings.get('secret:apiKey')).toMatchObject({ value: 'hidden' })

    await db.bookFiles.delete('book')
    await restoreBackup(json)
    expect((await db.books.get('book'))?.fileMissing).toBe(true)
    expect(await db.settings.get('secret:apiKey')).toMatchObject({ value: 'hidden' })
  })
})