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
    await db.observations.add({
      id: 'obs1',
      bookId: 'book',
      chapterId: 'c1',
      paragraphId: 'p1',
      oid: 'o1',
      kind: '矛盾',
      quote: '天还没亮',
      point: '天亮之前就有事',
      assignedRole: '毒舌',
      assignedName: '毒舌',
      authorType: 'resident',
      createdAt: '2026-11-05T00:00:00.000Z',
    })
    await db.deepSpots.add({
      id: 'spot1',
      bookId: 'book',
      chapterId: 'c1',
      startParagraphId: 'p1',
      endParagraphId: 'p2',
      startOrder: 1,
      endOrder: 2,
      label: '出门',
      why: '转折',
      lens: '细节',
      status: 'planned',
      createdAt: '2026-11-05T00:00:00.000Z',
    })
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
    expect(await db.observations.get('obs1')).toMatchObject({ point: '天亮之前就有事' })
    expect(await db.deepSpots.get('spot1')).toMatchObject({ label: '出门', status: 'planned' })
    expect(await db.bookFiles.get('book')).toBeTruthy()
    expect(await db.settings.get('llm.model')).toMatchObject({ value: 'demo' })
    expect(await db.settings.get('secret:apiKey')).toMatchObject({ value: 'hidden' })

    await db.bookFiles.delete('book')
    await restoreBackup(json)
    expect((await db.books.get('book'))?.fileMissing).toBe(true)
    expect(await db.settings.get('secret:apiKey')).toMatchObject({ value: 'hidden' })
  })
})