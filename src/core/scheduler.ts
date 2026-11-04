export type TaskKind = 'live' | 'rough' | 'refine' | 'chapterTalk'

export interface SchedulerTask {
  kind: TaskKind
  key: string
  distance: number
  run: (signal: AbortSignal) => Promise<void>
  /** 走实时优先级、但读者再跳走就没用了的任务（跳读生成），dropPending 时一并清掉。 */
  droppable?: boolean
}

const PRIORITY: Record<TaskKind, number> = { live: 0, rough: 1, refine: 2, chapterTalk: 3 }
const DEFAULT_LIMIT: Record<TaskKind, number> = { live: 1, rough: 1, refine: 2, chapterTalk: 1 }

interface Queued extends SchedulerTask {
  id: string
  abort: AbortController
}

/**
 * 任务队列不落库。实时、粗生成、精修各有并发上限。
 * 暂停时不再派发新任务，已经开始的任务会跑完。
 */
export class Scheduler {
  private queued: Queued[] = []
  private running = new Map<string, AbortController>()
  private paused = false
  private timer: ReturnType<typeof setTimeout> | 0 = 0
  private limit: Record<TaskKind, number> = { ...DEFAULT_LIMIT }

  /** 冷启动时临时放宽粗评并发，缓冲够了再收回。 */
  setLimit(kind: TaskKind, limit: number): void {
    const next = Math.max(1, limit)
    if (this.limit[kind] === next) return
    this.limit[kind] = next
    this.schedule()
  }

  limitOf(kind: TaskKind): number {
    return this.limit[kind]
  }

  enqueue(task: SchedulerTask): boolean {
    const id = `${task.kind}:${task.key}`
    if (this.queued.some((item) => item.id === id) || this.running.has(id)) return false
    this.queued.push({ ...task, id, abort: new AbortController() })
    this.queued.sort(
      (a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.distance - b.distance,
    )
    this.schedule()
    return true
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    this.schedule()
  }

  /** 清掉还没开始的粗生成、精修和可丢弃任务，返回这些任务对应的段落 id。正在跑的不中止。 */
  dropPending(kinds: Array<'rough' | 'refine'> = ['rough', 'refine']): string[] {
    const drop = (task: Queued) => task.droppable === true || kinds.includes(task.kind as 'rough' | 'refine')
    const dropped = this.queued.filter(drop)
    this.queued = this.queued.filter((task) => !drop(task))
    return dropped.flatMap((task) => task.key.split(','))
  }

  stop(): void {
    this.queued = []
    this.limit = { ...DEFAULT_LIMIT }
    for (const abort of this.running.values()) abort.abort()
    this.running.clear()
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = 0
    }
  }

  get pendingCount(): number {
    return this.queued.length
  }

  private schedule(): void {
    if (this.paused || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = 0
      this.dispatch()
    }, 0)
  }

  private dispatch(): void {
    if (this.paused) return
    for (const kind of ['live', 'rough', 'refine', 'chapterTalk'] as const) {
      let active = [...this.running.keys()].filter((id) => id.startsWith(`${kind}:`)).length
      while (active < this.limit[kind]) {
        const index = this.queued.findIndex((task) => task.kind === kind)
        if (index < 0) break
        const task = this.queued.splice(index, 1)[0]
        if (!task) break
        this.running.set(task.id, task.abort)
        active += 1
        void task
          .run(task.abort.signal)
          .catch(() => {
            // 调用方负责把失败写回段落。这里只保证队列继续。
          })
          .finally(() => {
            this.running.delete(task.id)
            this.schedule()
          })
      }
    }
  }
}
