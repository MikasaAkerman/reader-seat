import { buildBackup, parseBackup } from '@/core/export'
import { platform } from '@/platform'
import { db, type SettingsRow } from '../schema'

const TABLES = [
  'books',
  'chapters',
  'paragraphs',
  'residentReaders',
  'bookMemories',
  'predictions',
  'commentBatches',
  'comments',
  'userNotes',
  'chapterTalks',
  'readingStates',
  'generationLogs',
  'settings',
  'observations',
  'deepSpots',
] as const

function isSecret(row: unknown): boolean {
  return !!row && typeof row === 'object' && 'key' in row && String(row.key).startsWith('secret:')
}

export async function exportBackup(): Promise<string> {
  const tables: Record<string, unknown[]> = {}
  for (const name of TABLES) {
    const rows = await db.table(name).toArray()
    tables[name] = name === 'settings' ? rows.filter((row) => !isSecret(row)) : rows
  }
  return buildBackup(tables, { schemaVersion: 1, exportedAt: new Date().toISOString() })
}

export async function restoreBackup(json: string): Promise<void> {
  const { tables } = parseBackup(json)
  const writers = TABLES.map((name) => db.table(name))
  await db.transaction('rw', writers, async () => {
    for (const name of TABLES) {
      if (name === 'settings') {
        const secrets = (await db.settings.toArray()).filter((row) => isSecret(row))
        await db.settings.clear()
        if (secrets.length > 0) await db.settings.bulkAdd(secrets)
        const incoming = ((tables.settings ?? []) as SettingsRow[]).filter((row) => !isSecret(row))
        if (incoming.length > 0) await db.settings.bulkAdd(incoming)
      } else {
        await db.table(name).clear()
        const rows = tables[name] ?? []
        if (rows.length > 0) await db.table(name).bulkAdd(rows)
      }
    }
  })
  const books = await db.books.toArray()
  for (const book of books) {
    const present = await platform.hasBookFile(book.id).catch(() => false)
    await db.books.update(book.id, { fileMissing: !present })
  }
}
