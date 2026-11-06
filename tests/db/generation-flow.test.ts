import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZodType } from 'zod'
import { EMPTY_USAGE, type ChatMessage, type LlmClient } from '@/core/llm'
import {
  appendComment,
  commentsInBatch,
  listBatches,
  listThreads,
  readMemory,
  saveNextBatch,
  saveParagraphComments,
  setCommentMark,
  updateMemory,
} from '@/db/repos/comments'
import { rowsToCarry } from '@/core/comments/batches'
import { db, type BookRow, type ChapterRow, type ParagraphRow } from '@/db/schema'

const fake = vi.hoisted(() => ({
  jsonl: [] as unknown[],
  observe: null as unknown,
  refine: null as unknown,
  chapter: null as unknown,
  spoilerFails: false,
  calls: [] as string[],
  prompts: [] as string[],
}))

function fakeClient(): LlmClient {
  return {
    async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>) {
      const all = messages.map((message) => message.content).join('\n')
      fake.prompts.push(all)
      if (all.includes('检查读书评论有没有剧透')) {
        fake.calls.push('spoiler')
        if (fake.spoilerFails) throw new Error('校验服务挂了')
        return { data: schema.parse({ results: [{ id: 'r0', pass: true }] }), usage: EMPTY_USAGE }
      }
      if (all.includes('章末整理')) {
        fake.calls.push('chapter')
        return { data: schema.parse(fake.chapter), usage: EMPTY_USAGE }
      }
      if (all.includes('只做观察')) {
        fake.calls.push('observe')
        return { data: schema.parse(fake.observe), usage: EMPTY_USAGE }
      }
      if (all.includes('挑选真正值得深入')) {
        fake.calls.push('deepPlan')
        return { data: schema.parse({ spots: [] }), usage: EMPTY_USAGE }
      }
      fake.calls.push('json')
      return { data: schema.parse(fake.refine), usage: EMPTY_USAGE }
    },
    async chatStream() {
      return EMPTY_USAGE
    },
    async chatJsonl<T>(_messages: unknown, schema: ZodType<T>, onItem: (item: T) => void) {
      fake.calls.push('jsonl')
      for (const line of fake.jsonl) onItem(schema.parse(line))
      return EMPTY_USAGE
    },
  }
}

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    loaded: true,
    apiKey: 'test',
    model: 'test',
    chapterReasoning: false,
    pricing: { inputHitPerMTok: 0, inputMissPerMTok: 0, outputPerMTok: 0 },
    load: async () => {},
    createClient: fakeClient,
  }),
}))

vi.mock('@/stores/comments', () => ({
  useCommentsStore: () => ({ loadChapter: async () => {} }),
}))

const book: BookRow = {
  id: 'book',
  title: '巷口',
  author: '作者',
  translator: '',
  fingerprint: 'f',
  station: null,
  spoilerLevel: '全开放',
  unlockMode: 'free',
  longComments: false,
  lineup: {},
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
} as BookRow

const chapter: ChapterRow = { id: 'c1', bookId: 'book', order: 1, href: 'c1.xhtml', title: '第一章', readStatus: 'reading' }

function paragraph(order: number, extra: Partial<ParagraphRow> = {}): ParagraphRow {
  return {
    id: `p${order}`,
    bookId: 'book',
    chapterId: 'c1',
    order,
    anchor: `a${order}`,
    text: `第${order}段，天还没亮。`,
    html: '',
    textHash: `h${order}`,
    kind: 'body',
    genStatus: 'none',
    ...extra,
  }
}

const resident = (text: string) => ({ authorType: 'resident' as const, displayName: '毒舌', role: '毒舌', text })

beforeEach(async () => {
  await Promise.all([
    db.books.clear(),
    db.chapters.clear(),
    db.paragraphs.clear(),
    db.comments.clear(),
    db.commentBatches.clear(),
    db.bookMemories.clear(),
    db.generationLogs.clear(),
    db.observations.clear(),
    db.deepSpots.clear(),
  ])
  await db.books.add(book)
  await db.chapters.add(chapter)
  fake.jsonl = []
  fake.observe = null
  fake.refine = null
  fake.chapter = null
  fake.spoilerFails = false
  fake.calls = []
  fake.prompts = []
})

describe('batches and user content', () => {
  it('shows a comment written after a reroll, and keeps it when switching batches', async () => {
    await db.paragraphs.add(paragraph(1, { genStatus: 'rough', score: 2 }))
    await saveParagraphComments('p1', [resident('第一批')], 2, 'rough')
    const [first] = await listBatches('p1')
    const carried = rowsToCarry(await commentsInBatch(first!.id))
    await saveNextBatch('p1', 2, [
      ...carried,
      { ...carried[0]!, id: 'new', authorType: 'passerby', displayName: '路人', role: '', text: '第二批' },
    ])

    await appendComment('p1', { authorType: 'user', displayName: '我', role: '', text: '我的看法' })
    expect((await listThreads('p1')).map((thread) => thread.text)).toContain('我的看法')
    expect((await listThreads('p1', 1)).map((thread) => thread.text)).toContain('我的看法')

    const passer = (await listThreads('p1')).find((thread) => thread.text === '第二批')!
    await appendComment('p1', { authorType: 'user', displayName: '我', role: '', text: '回路人' }, passer.id)
    const latest = (await listThreads('p1')).find((thread) => thread.id === passer.id)
    expect(latest?.replies.map((reply) => reply.text)).toEqual(['回路人'])
  })

  it('keeps a thread the reader replied in, and carries marks, when refine rewrites the batch', async () => {
    await db.paragraphs.add(paragraph(1, { genStatus: 'refining', score: 3 }))
    await saveParagraphComments('p1', [resident('占位'), resident('会被收藏')], 3, 'refining')
    const before = await listThreads('p1')
    const placeholder = before.find((thread) => thread.text === '占位')!
    const saved = before.find((thread) => thread.text === '会被收藏')!
    await appendComment('p1', { authorType: 'user', displayName: '我', role: '', text: '我回一句' }, placeholder.id)
    await setCommentMark(saved.id, 'saved', true)

    await saveParagraphComments('p1', [resident('会被收藏'), resident('精修一')], 3, 'refined')

    const after = await listThreads('p1')
    expect(after.map((thread) => thread.text).sort()).toEqual(['会被收藏', '占位', '精修一'].sort())
    expect(after.find((thread) => thread.text === '占位')?.replies.map((reply) => reply.text)).toEqual(['我回一句'])
    expect(after.find((thread) => thread.text === '会被收藏')?.marks.saved).toBe(true)
  })
})

describe('memory merge', () => {
  it('keeps both updates when two tasks merge at the same time', async () => {
    await Promise.all([
      updateMemory('book', (state) => ({ ...state, entities: [...state.entities, '老周'] })),
      updateMemory('book', (state) => ({
        ...state,
        memory: { ...state.memory, userStance: [...state.memory.userStance, '喜欢开头'] },
      })),
      updateMemory('book', (state) => ({ ...state, entities: [...state.entities, '巷口'] })),
    ])
    const state = await readMemory('book')
    expect(state.entities.sort()).toEqual(['巷口', '老周'].sort())
    expect(state.memory.userStance).toEqual(['喜欢开头'])
  })
})

describe('generation store', () => {
  afterEach(async () => {
    const { useGenerationStore } = await import('@/stores/generation')
    useGenerationStore().stop()
  })

  async function startStore() {
    setActivePinia(createPinia())
    const { useGenerationStore } = await import('@/stores/generation')
    const store = useGenerationStore()
    await store.sync({ bookId: 'book', chapterId: 'c1', order: 1 })
    return store
  }

  const refineResult = {
    pid: 'p2',
    threads: [{ root: { author_type: 'resident', reader_role: '毒舌', text: '精修主楼，天还没亮。', quote: '天还没亮' }, replies: [] }],
    memory_updates: { nicknames: [{ character: '老周', nickname: '周叔', by: '毒舌' }] },
  }

  it('re-enqueues a paragraph left in refining after its queued task was dropped', async () => {
    await db.paragraphs.bulkAdd([
      paragraph(1, { genStatus: 'rough', score: 1 }),
      paragraph(2, { genStatus: 'refining', score: 3 }),
      paragraph(3, { genStatus: 'rough', score: 0 }),
    ])
    await saveParagraphComments('p2', [resident('占位')], 3, 'refining')
    fake.refine = refineResult

    await startStore()

    await vi.waitFor(async () => expect((await db.paragraphs.get('p2'))?.genStatus).toBe('refined'))
    expect((await listThreads('p2')).map((thread) => thread.text)).toEqual(['精修主楼，天还没亮。'])
    expect((await readMemory('book')).memory.nicknames.map((item) => item.nickname)).toEqual(['周叔'])
    expect(fake.calls).not.toContain('jsonl')
  })

  it('streams a cold block paragraph by paragraph and refines the hot one', async () => {
    await db.paragraphs.bulkAdd([paragraph(1), paragraph(2), paragraph(3)])
    fake.observe = {
      paragraphs: [
        {
          pid: 'p2',
          score: 3,
          observations: [{ oid: 'o1', kind: '矛盾', quote: '天还没亮', point: '天亮之前就有事' }],
        },
      ],
      hot_pids: ['p2'],
      new_entities: ['老周'],
    }
    fake.jsonl = [{ cid: 'c1', text: '热段占位，天还没亮。', quote: '天还没亮' }]
    fake.refine = refineResult

    await startStore()

    await vi.waitFor(async () => expect((await db.paragraphs.get('p2'))?.genStatus).toBe('refined'))
    const rows = await db.paragraphs.bulkGet(['p1', 'p2', 'p3'])
    expect(rows.map((row) => row?.genStatus)).toEqual(['rough', 'refined', 'rough'])
    expect((await listThreads('p1')).map((thread) => thread.text)).toEqual([])
    expect((await listThreads('p2')).map((thread) => thread.text)).toEqual(['精修主楼，天还没亮。'])
    expect((await readMemory('book')).entities).toContain('老周')
    expect(fake.calls.filter((call) => call === 'jsonl')).toHaveLength(1)
  })

  it('advances the synopsis only from the furthest chapter and keeps it out of earlier chapters', async () => {
    await db.chapters.bulkAdd([
      { id: 'c0', bookId: 'book', order: 0, href: 'c0.xhtml', title: '序', readStatus: 'done' },
      { id: 'c2', bookId: 'book', order: 2, href: 'c2.xhtml', title: '第二章', readStatus: 'unread' },
    ])
    await db.paragraphs.bulkAdd([
      paragraph(1, { genStatus: 'rough', score: 1 }),
      { ...paragraph(1, { genStatus: 'rough', score: 1 }), id: 'q1', chapterId: 'c0' },
    ])
    fake.chapter = { summary: '第一章摘要', synopsis_update: '读到第一章为止的梗概', resident_lines: [] }
    const store = await startStore()

    await store.finishChapter('c1')
    await vi.waitFor(async () => expect((await readMemory('book')).synopsisThrough).toBe(1))
    expect((await readMemory('book')).synopsis).toBe('读到第一章为止的梗概')

    fake.chapter = { summary: '序的摘要', synopsis_update: '不该覆盖', resident_lines: [] }
    await store.sync({ bookId: 'book', chapterId: 'c0', order: 1 })
    await store.finishChapter('c0')
    await vi.waitFor(async () => expect((await db.chapters.get('c0'))?.summary).toBe('序的摘要'))
    expect((await readMemory('book')).synopsis).toBe('读到第一章为止的梗概')
    expect(fake.prompts.at(-1)).not.toContain('读到第一章为止的梗概')
  })

  it('keeps the rough placeholder in strict mode when the spoiler check fails', async () => {
    await db.books.update('book', { spoilerLevel: '严格' })
    await db.paragraphs.bulkAdd([
      paragraph(1, { genStatus: 'rough', score: 1 }),
      paragraph(2, { genStatus: 'refining', score: 3 }),
    ])
    await saveParagraphComments('p2', [resident('占位')], 3, 'refining')
    fake.refine = refineResult
    fake.spoilerFails = true

    await startStore()

    await vi.waitFor(async () => expect((await db.paragraphs.get('p2'))?.genStatus).toBe('rough'))
    expect((await listThreads('p2')).map((thread) => thread.text)).toEqual(['占位'])
    expect(fake.calls).toContain('spoiler')
  })

  it('does not generate short comments when the book turns them off', async () => {
    await db.books.update('book', { shortComments: false })
    await db.paragraphs.bulkAdd([paragraph(1), paragraph(2)])
    await startStore()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fake.calls).not.toContain('observe')
    expect(fake.calls).not.toContain('jsonl')
    expect((await db.paragraphs.get('p1'))?.genStatus).toBe('none')
  })

  it('does not plan a long comment when the book turns them off', async () => {
    await db.paragraphs.bulkAdd([paragraph(1, { genStatus: 'rough', score: 1 })])
    await startStore()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fake.calls).not.toContain('deepPlan')
  })

  it('plans a long comment between the book minimum and maximum', async () => {
    await db.books.update('book', { longComments: true, deepMinPerChapter: 1, deepMaxPerChapter: 2 })
    await db.paragraphs.bulkAdd([paragraph(1, { genStatus: 'rough', score: 1 })])
    await startStore()
    await vi.waitFor(() => expect(fake.calls).toContain('deepPlan'))
    expect(fake.prompts.some((prompt) => prompt.includes('选出 1 到 2 处'))).toBe(true)
  })

  it('allows five interesting marks per chapter', async () => {
    await db.paragraphs.bulkAdd(
      Array.from({ length: 6 }, (_, index) =>
        paragraph(index + 1, {
          genStatus: 'refined',
          score: 2,
          ...(index < 5 ? { userMarked: 'interesting' as const } : {}),
        }),
      ),
    )
    const store = await startStore()
    await store.markInteresting('p6')
    expect(store.notice).toContain('5')
    expect((await db.paragraphs.get('p6'))?.userMarked).toBeUndefined()
  })
})
