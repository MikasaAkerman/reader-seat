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
