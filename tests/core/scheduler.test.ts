import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUFFER_TARGET, planNextBlock, readyAhead } from '@/core/generation/pipeline'
import { Scheduler } from '@/core/scheduler'
import type { ParagraphRow } from '@/db/schema'

function held() {
  let release: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release() }
}

function row(order: number, text: string): ParagraphRow {
  return {
    id: `p${order}`,
    bookId: 'b',
    chapterId: 'c',
    order,
    anchor: String(order),
    text,
    html: text,
    textHash: String(order),
    kind: 'paragraph',
    genStatus: 'none',
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduler', () => {
  it('starts live, rough and refine together, and drops a duplicate', async () => {
    const scheduler = new Scheduler()
    const started: string[] = []
    const gate = held()
    scheduler.enqueue({
      kind: 'refine',
      key: 'hot',
      distance: 3,
      run: async () => {
        started.push('refine')
      },
    })
    scheduler.enqueue({
      kind: 'rough',
      key: 'block',
      distance: 1,
      run: async () => {
        started.push('rough')
        await gate.promise
      },
    })
    scheduler.enqueue({
      kind: 'live',
      key: 'now',
      distance: 9,
      run: async () => {
        started.push('live')
      },
    })
    const duplicate = scheduler.enqueue({
      kind: 'rough',
      key: 'block',
      distance: 0,
      run: async () => {
        started.push('duplicate')
      },
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(duplicate).toBe(false)
    expect(started).toEqual(['live', 'rough', 'refine'])
    expect(scheduler.pendingCount).toBe(0)
    gate.release()
    await vi.runAllTimersAsync()
  })

  it('runs the nearer refine first when only one slot frees', async () => {
    const scheduler = new Scheduler()
    const first = held()
    const second = held()
    const order: string[] = []
    scheduler.enqueue({ kind: 'refine', key: 'a', distance: 0, run: () => first.promise })
    scheduler.enqueue({ kind: 'refine', key: 'b', distance: 0, run: () => second.promise })
    await vi.advanceTimersByTimeAsync(0)
    scheduler.enqueue({
      kind: 'refine',
      key: 'far',
      distance: 9,
      run: async () => {
        order.push('far')
      },
    })
    scheduler.enqueue({
      kind: 'refine',
      key: 'near',
      distance: 1,
      run: async () => {
        order.push('near')
      },
    })
    first.release()
    await vi.runAllTimersAsync()
    expect(order[0]).toBe('near')
    second.release()
    await vi.runAllTimersAsync()
  })

  it('drops queued rough and refine on a jump, and keeps the live task', async () => {
    const scheduler = new Scheduler()
    scheduler.pause()
    const ran: string[] = []
    scheduler.enqueue({
      kind: 'rough',
      key: 'p1,p2',
      distance: 4,
      run: async () => {
        ran.push('rough')
      },
    })
    scheduler.enqueue({
      kind: 'refine',
      key: 'p3',
      distance: 2,
      run: async () => {
        ran.push('refine')
      },
    })
    scheduler.enqueue({
      kind: 'live',
      key: 'p9',
      distance: 0,
      run: async () => {
        ran.push('live')
      },
    })
    expect(scheduler.dropPending()).toEqual(['p1', 'p2', 'p3'])
    expect(scheduler.pendingCount).toBe(1)
    scheduler.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(ran).toEqual(['live'])
  })

  it('does not dispatch while paused, then resumes the queue', async () => {
    const scheduler = new Scheduler()
    const ran: string[] = []
    scheduler.pause()
    scheduler.enqueue({
      kind: 'rough',
      key: 'later',
      distance: 0,
      run: async () => {
        ran.push('rough')
      },
    })
    await vi.advanceTimersByTimeAsync(20)
    expect(ran).toEqual([])
    expect(scheduler.pendingCount).toBe(1)
    scheduler.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(ran).toEqual(['rough'])
  })

  it('fills the read-ahead buffer without starting the same paragraph twice', async () => {
    const text = '字'.repeat(400)
    const rows = Array.from({ length: 20 }, (_, index) => row(index + 1, text))
    const inflight = new Set<string>()
    const scheduler = new Scheduler()
    const started: string[] = []
    let covered = readyAhead(rows, 1, inflight)
    let cursor = 1
    while (covered < BUFFER_TARGET) {
      const block = planNextBlock(rows, cursor, inflight)
      expect(block).not.toBeNull()
      if (!block || block.length === 0) break
      for (const item of block) inflight.add(item.id)
      scheduler.enqueue({
        kind: 'rough',
        key: block.map((item) => item.id).join(','),
        distance: block[0]!.order - 1,
        run: async () => {
          started.push(...block.map((item) => item.id))
        },
      })
      covered += block.length
      cursor = block[block.length - 1]!.order + 1
    }
    expect(covered).toBeGreaterThanOrEqual(BUFFER_TARGET)
    await vi.runAllTimersAsync()
    expect(started.length).toBeGreaterThanOrEqual(BUFFER_TARGET)
    expect(new Set(started).size).toBe(started.length)
  })

  it('aborts work already running when stopped', async () => {
    const scheduler = new Scheduler()
    let signal: AbortSignal | undefined
    scheduler.enqueue({
      kind: 'rough',
      key: 'running',
      distance: 0,
      run: (abort) =>
        new Promise((resolve) => {
          signal = abort
          abort.addEventListener('abort', () => resolve())
        }),
    })
    await vi.advanceTimersByTimeAsync(0)
    scheduler.enqueue({ kind: 'refine', key: 'waiting', distance: 0, run: async () => {} })
    scheduler.stop()
    expect(signal?.aborted).toBe(true)
    expect(scheduler.pendingCount).toBe(0)
  })
})
