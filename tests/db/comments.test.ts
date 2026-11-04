import { beforeEach, describe, expect, it } from 'vitest'
import { bubbleFor, listThreads, saveParagraphComments, setCommentMark, threadsFrom } from '@/db/repos/comments'
import { db, type CommentRow, type ParagraphRow } from '@/db/schema'

const paragraph: ParagraphRow = {
  id: 'p1',
  bookId: 'book',
  chapterId: 'chapter',
  order: 1,
  anchor: 'p1',
  text: '灯灭了。',
  html: '<p>灯灭了。</p>',
  textHash: 'hash',
  kind: 'body',
  genStatus: 'none',
}

beforeEach(async () => {
  await Promise.all([
    db.paragraphs.clear(),
    db.comments.clear(),
    db.commentBatches.clear(),
    db.bookMemories.clear(),
    db.generationLogs.clear(),
  ])
  await db.paragraphs.add(paragraph)
})

describe('comment batches', () => {
  it('keeps the first batch when the paragraph is generated again', async () => {
    await saveParagraphComments(
      'p1',
      [{ authorType: 'resident', displayName: '考据癖', role: '考据癖', text: '第一次' }],
      2,
      'rough',
    )
    await saveParagraphComments(
      'p1',
      [
        {
          authorType: 'passerby',
          displayName: '路人甲',
          role: '',
          text: '第二次',
          replies: [
            { authorType: 'resident', displayName: '段子手', role: '段子手', text: '回复一' },
            { authorType: 'resident', displayName: '考据癖', role: '考据癖', text: '回复二' },
            { authorType: 'passerby', displayName: '路过', role: '', text: '回复三' },
          ],
        },
      ],
      2,
      'rough',
    )

    const batches = await db.commentBatches.where('paragraphId').equals('p1').toArray()
    expect(batches.map((batch) => batch.batchNo)).toEqual([1])
    const threads = await listThreads('p1')
    expect(threads.map((thread) => thread.text)).toEqual(['第二次'])
    expect(threads[0]?.replies.map((reply) => reply.text)).toEqual(['回复一', '回复二', '回复三'])
    const stored = await db.paragraphs.get('p1')
    expect(stored?.score).toBe(2)
    expect(stored?.genStatus).toBe('rough')
    expect(bubbleFor(stored?.genStatus, stored?.score, 4, false)?.count).toBe(4)
  })

  it('lists resident threads before passersby and leaves a failed paragraph without a count', () => {
    const comments: CommentRow[] = [
      {
        id: 'a',
        batchId: 'b',
        paragraphId: 'p1',
        parentId: '',
        authorType: 'passerby',
        displayName: '路人',
        role: '',
        text: '后排',
      },
      {
        id: 'b',
        batchId: 'b',
        paragraphId: 'p1',
        parentId: '',
        authorType: 'resident',
        displayName: '考据癖',
        role: '考据癖',
        text: '前排',
      },
      {
        id: 'c',
        batchId: 'b',
        paragraphId: 'p1',
        parentId: '',
        authorType: 'user',
        displayName: '我',
        role: '',
        text: '最上',
      },
      {
        id: 'd',
        batchId: 'b',
        paragraphId: 'p1',
        parentId: '',
        authorType: 'resident',
        displayName: '剧透',
        role: '毒舌',
        text: '后文',
        spoiler: true,
      },
    ]
    expect(threadsFrom(comments.filter((comment) => !comment.spoiler)).map((thread) => thread.displayName)).toEqual([
      '我',
      '考据癖',
      '路人',
    ])
    expect(bubbleFor('failed', 2, 0, false)?.failed).toBe(true)
    expect(bubbleFor('failed', 2, 0, false)?.count).toBe(0)
  })

  it('hides a comment once it is marked as a spoiler', async () => {
    await saveParagraphComments(
      'p1',
      [{ authorType: 'resident', displayName: '毒舌', role: '毒舌', text: '后文才揭晓' }],
      2,
      'rough',
    )
    const [thread] = await listThreads('p1')
    await setCommentMark(thread?.id ?? '', 'spoiler', true)
    expect(await listThreads('p1')).toEqual([])
  })
})
