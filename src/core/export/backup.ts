export const BACKUP_SCHEMA_VERSION = 1

export interface BackupMeta {
  schemaVersion: number
  exportedAt: string
}

export function buildBackup(tables: Record<string, unknown[]>, meta: BackupMeta): string {
  return JSON.stringify({ meta, tables })
}

export function parseBackup(json: string): { meta: BackupMeta; tables: Record<string, unknown[]> } {
  const parsed: unknown = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object') throw new Error('这份备份无法读取')
  const record = parsed as { meta?: BackupMeta; tables?: Record<string, unknown[]> }
  if (record.meta?.schemaVersion !== BACKUP_SCHEMA_VERSION || !record.tables) {
    throw new Error('这份备份无法读取')
  }
  return { meta: record.meta, tables: record.tables }
}
