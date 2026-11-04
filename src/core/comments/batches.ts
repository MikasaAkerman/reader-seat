export const REROLL_DAILY_LIMIT = 3

export function localDay(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function latestBatch<T extends { batchNo: number }>(batches: T[]): T | undefined {
  return [...batches].sort((a, b) => b.batchNo - a.batchNo)[0]
}

export function rerollsOnDay(batches: { batchNo: number; createdAt: string }[], day: string): number {
  return batches.filter((batch) => batch.batchNo > 1 && localDay(batch.createdAt) === day).length
}

export function canReroll(batches: { batchNo: number; createdAt: string }[], now: Date): boolean {
  return rerollsOnDay(batches, localDay(now)) < REROLL_DAILY_LIMIT
}

export function nextBatchNo(batches: { batchNo: number }[]): number {
  return batches.reduce((max, batch) => Math.max(max, batch.batchNo), 0) + 1
}

interface ThreadRow {
  id: string
  parentId: string
  authorType: string
}

/**
 * 换一批时带到新批里的评论：常驻书友的整楼，以及用户回过话的路人楼。
 * 回复只跟着自己的主楼走，主楼没带过去的回复不留。
 */
export function rowsToCarry<T extends ThreadRow>(rows: T[]): T[] {
  const userReplied = new Set(rows.filter((row) => row.parentId && row.authorType === 'user').map((row) => row.parentId))
  const roots = new Set(
    rows
      .filter((row) => !row.parentId && (row.authorType !== 'passerby' || userReplied.has(row.id)))
      .map((row) => row.id),
  )
  return rows.filter((row) => (row.parentId ? roots.has(row.parentId) : roots.has(row.id)))
}

/** 重新生成时必须原样保留的主楼：用户回过话的 AI 主楼。 */
export function rootsWithUserReplies<T extends ThreadRow>(rows: T[]): Set<string> {
  return new Set(rows.filter((row) => row.parentId && row.authorType === 'user').map((row) => row.parentId))
}
