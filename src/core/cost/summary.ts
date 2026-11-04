import { localDay } from '../comments/batches'

export interface CostLog {
  bookId: string
  createdAt: string
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  cost: number
  latencyMs?: number
}

export interface CostBook {
  bookId: string
  title: string
  calls: number
  promptTokens: number
  completionTokens: number
  cost: number
  cacheHitRate: number
  latencyMs: number | null
}

export interface CostDay {
  day: string
  calls: number
  cost: number
  promptTokens: number
  completionTokens: number
}

function rate(hit: number, prompt: number): number {
  if (prompt <= 0) return 0
  return hit / prompt
}

export function summarizeCosts(logs: CostLog[], titles: Record<string, string>): { books: CostBook[]; days: CostDay[] } {
  const books = new Map<string, CostBook & { hit: number; latencySum: number; latencyCount: number }>()
  const days = new Map<string, CostDay>()
  for (const log of logs) {
    const book = books.get(log.bookId) ?? {
      bookId: log.bookId,
      title: titles[log.bookId] || '未命名',
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      cacheHitRate: 0,
      latencyMs: null,
      hit: 0,
      latencySum: 0,
      latencyCount: 0,
    }
    book.calls += 1
    book.promptTokens += log.promptTokens
    book.completionTokens += log.completionTokens
    book.cost += log.cost
    book.hit += log.cacheHitTokens
    if (typeof log.latencyMs === 'number') {
      book.latencySum += log.latencyMs
      book.latencyCount += 1
    }
    books.set(log.bookId, book)

    const dayKey = localDay(log.createdAt)
    if (!dayKey) continue
    const day = days.get(dayKey) ?? { day: dayKey, calls: 0, cost: 0, promptTokens: 0, completionTokens: 0 }
    day.calls += 1
    day.cost += log.cost
    day.promptTokens += log.promptTokens
    day.completionTokens += log.completionTokens
    days.set(dayKey, day)
  }
  return {
    books: [...books.values()]
      .map((book) => ({
        bookId: book.bookId,
        title: book.title,
        calls: book.calls,
        promptTokens: book.promptTokens,
        completionTokens: book.completionTokens,
        cost: book.cost,
        cacheHitRate: rate(book.hit, book.promptTokens),
        latencyMs: book.latencyCount > 0 ? Math.round(book.latencySum / book.latencyCount) : null,
      }))
      .sort((a, b) => b.cost - a.cost),
    days: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
  }
}
