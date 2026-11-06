import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteBook, getBook, getReadingState, importBookBytes, recordProgress, updateBookSettings } from '@/db/repos/library'
import { db } from '@/db/schema'
import { createId } from '@/db/id'

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const opf = (translator = '') => `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>巷口</dc:title>
    <dc:creator>样例作者</dc:creator>
    ${translator ? `<dc:contributor opf:role="trl">${translator}</dc:contributor>` : ''}
  </metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`

async function epub(text: string, translator = '', extra = ''): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', container)
  zip.file('OEBPS/content.opf', opf(translator))
  zip.file(
    'OEBPS/c1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>灯灭了</h1><p>${text}</p>${extra}</body></html>`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}

beforeEach(async () => {
  await Promise.all([
    db.books.clear(),
    db.chapters.clear(),
    db.paragraphs.clear(),
    db.comments.clear(),
    db.readingStates.clear(),
    db.bookFiles.clear(),
    db.commentBatches.clear(),
    db.userNotes.clear(),
    db.chapterTalks.clear(),
    db.observations.clear(),
    db.deepSpots.clear(),
  ])
})

describe('library import', () => {
  it('imports, dedupes by fingerprint, relinks a new edition, and deletes', async () => {
    const created = await importBookBytes(await epub('原来的句子。'), '巷口.epub')
    expect(created.status).toBe('created')
    const again = await importBookBytes(await epub('原来的句子。'), '巷口.epub')
    expect(again).toEqual({ status: 'existing', bookId: created.bookId })

    const oldParagraphs = await db.paragraphs.where('bookId').equals(created.bookId).toArray()
    const kept = oldParagraphs.find((paragraph) => paragraph.text === '灯灭了')
    const dropped = oldParagraphs.find((paragraph) => paragraph.text === '原来的句子。')
    await db.comments.bulkAdd([
      {
        id: 'keep',
        batchId: 'b',
        paragraphId: kept?.id ?? '',
        parentId: '',
        authorType: 'resident',
        displayName: '考据癖',
        role: '考据癖',
        text: '留下',
      },
      {
        id: 'drop',
        batchId: 'b',
        paragraphId: dropped?.id ?? '',
        parentId: '',
        authorType: 'resident',
        displayName: '考据癖',
        role: '考据癖',
        text: '丢掉',
      },
    ])

    const edition = await epub('')
    expect(await importBookBytes(edition, '巷口.epub')).toEqual({
      status: 'conflict',
      bookId: created.bookId,
      title: '巷口',
    })
    const updated = await importBookBytes(edition, '巷口.epub', { onConflict: 'replace' })
    expect(updated).toEqual({ status: 'updated', bookId: created.bookId })
    expect(await db.books.count()).toBe(1)
    const keep = await db.comments.get('keep')
    const drop = await db.comments.get('drop')
    expect(keep?.mismatched).toBe(false)
    expect(keep?.paragraphId).not.toBe(kept?.id)
    expect(drop?.mismatched).toBe(true)

    await updateBookSettings(created.bookId, {
      spoilerLevel: '全开放',
      unlockMode: '章末解锁',
      station: 3,
      lineup: { 毒舌: false },
    })
    expect((await getBook(created.bookId))?.station).toBe(3)
    expect((await getBook(created.bookId))?.unlockMode).toBe('章末解锁')
    expect((await getBook(created.bookId))?.shortComments).not.toBe(false)
    await updateBookSettings(created.bookId, {
      spoilerLevel: '全开放',
      unlockMode: '章末解锁',
      station: 3,
      lineup: { 毒舌: false },
      shortComments: false,
      longComments: true,
      deepMinPerChapter: 2,
      deepMaxPerChapter: 5,
    })
    expect(await getBook(created.bookId)).toMatchObject({
      shortComments: false,
      longComments: true,
      deepMinPerChapter: 2,
      deepMaxPerChapter: 5,
    })

    const chapter = await db.chapters.where('bookId').equals(created.bookId).first()
    await recordProgress(created.bookId, {
      chapterId: chapter?.id ?? '',
      paragraphIndex: 1,
      offsetRatio: 0.25,
      readUpTo: 2,
      chapterLength: 2,
    })
    expect((await getReadingState(created.bookId))?.offsetRatio).toBe(0.25)
    expect((await db.chapters.get(chapter?.id ?? ''))?.readStatus).toBe('done')
    await recordProgress(created.bookId, {
      chapterId: chapter?.id ?? '',
      paragraphIndex: 1,
      offsetRatio: 0,
      readUpTo: 1,
      chapterLength: 2,
    })
    expect((await db.chapters.get(chapter?.id ?? ''))?.readStatus).toBe('done')

    await db.bookMemories.put({
      bookId: created.bookId,
      nicknames: [],
      predictions: [],
      debates: [],
      entities: [],
      updatedAt: new Date().toISOString(),
    })
    await deleteBook(created.bookId)
    expect(await db.books.count()).toBe(0)
    expect(await db.paragraphs.count()).toBe(0)
    expect(await db.comments.count()).toBe(0)
    expect(await db.bookMemories.count()).toBe(0)
    expect(await db.bookFiles.count()).toBe(0)
  })

  it('reattaches the same file without dropping comments', async () => {
    const bytes = await epub('原来的句子。')
    const created = await importBookBytes(bytes, '巷口.epub')
    const paragraph = await db.paragraphs.where('bookId').equals(created.bookId).first()
    await db.comments.add({
      id: 'kept-comment',
      batchId: 'batch',
      paragraphId: paragraph?.id ?? '',
      parentId: '',
      authorType: 'user',
      displayName: '我',
      role: '',
      text: '留下',
    })
    await db.bookFiles.delete(created.bookId)
    await db.books.update(created.bookId, { fileMissing: true })

    const again = await importBookBytes(bytes, '巷口.epub')
    expect(again).toEqual({ status: 'existing', bookId: created.bookId })
    expect(await db.bookFiles.get(created.bookId)).toBeTruthy()
    expect((await getBook(created.bookId))?.fileMissing).toBe(false)
    expect(await db.comments.get('kept-comment')).toMatchObject({ text: '留下' })
  })

  it('does not write anything when the file is not an epub', async () => {
    await expect(importBookBytes(new Uint8Array([1, 2, 3]), 'bad.epub')).rejects.toThrow(/EPUB/)
    expect(await db.books.count()).toBe(0)
  })

  it('imports a same-titled book with another translator as a separate book', async () => {
    await importBookBytes(await epub('原来的句子。', '甲'), '巷口.epub')
    const other = await importBookBytes(await epub('别的译法。', '乙'), '巷口.epub')
    expect(other.status).toBe('created')
    expect(await db.books.count()).toBe(2)
    const separate = await importBookBytes(await epub('甲的修订。', '甲'), '巷口.epub', { onConflict: 'separate' })
    expect(separate.status).toBe('created')
    expect(await db.books.count()).toBe(3)
  })

  it('moves batches, notes, chapter talk, summary and progress onto the new edition', async () => {
    const created = await importBookBytes(await epub('原来的句子。', '', '<p>第三段不变。</p>'), '巷口.epub')
    const [chapter] = await db.chapters.where('bookId').equals(created.bookId).toArray()
    const rows = await db.paragraphs.where('bookId').equals(created.bookId).sortBy('order')
    const edited = rows[1]!
    const stable = rows[2]!
    await db.chapters.update(chapter!.id, { summary: '灯灭以后', readStatus: 'done' })
    await db.paragraphs.update(stable.id, { genStatus: 'refined', score: 3, userMarked: 'interesting' })
    await db.commentBatches.add({ id: 'batch', paragraphId: stable.id, batchNo: 1, createdAt: '' })
    await db.comments.add({
      id: 'c',
      batchId: 'batch',
      paragraphId: edited.id,
      parentId: '',
      authorType: 'user',
      displayName: '我',
      role: '',
      text: '改字也跟着走',
    })
    await db.userNotes.add({
      id: createId(),
      bookId: created.bookId,
      chapterId: chapter!.id,
      paragraphId: stable.id,
      type: '划线批注',
      text: '批注',
      quote: '第三段',
      createdAt: '',
    })
    await db.chapterTalks.add({
      id: 'talk',
      bookId: created.bookId,
      chapterId: chapter!.id,
      paragraphId: '',
      hotParagraphIds: [stable.id],
      residentLines: [],
      debates: [],
      predictionUpdates: [],
      replies: [],
      createdAt: '',
    })
    await recordProgress(created.bookId, {
      chapterId: chapter!.id,
      paragraphIndex: 3,
      offsetRatio: 0.5,
      readUpTo: 3,
      chapterLength: 3,
    })

    const outcome = await importBookBytes(
      await epub('前面插了一段。', '', '<p>原来的句子，改了几个字。</p><p>第三段不变。</p>'),
      '巷口.epub',
      { onConflict: 'replace' },
    )
    expect(outcome.status).toBe('updated')
    const [nextChapter] = await db.chapters.where('bookId').equals(created.bookId).toArray()
    const next = await db.paragraphs.where('bookId').equals(created.bookId).sortBy('order')
    const moved = next.find((row) => row.text === '第三段不变。')!
    expect(moved.order).toBe(4)
    expect(moved).toMatchObject({ genStatus: 'refined', score: 3, userMarked: 'interesting' })
    expect(nextChapter).toMatchObject({ summary: '灯灭以后', readStatus: 'done' })
    expect((await db.commentBatches.get('batch'))?.paragraphId).toBe(moved.id)
    expect((await db.userNotes.toArray())[0]).toMatchObject({ chapterId: nextChapter!.id, paragraphId: moved.id })
    expect(await db.chapterTalks.get('talk')).toMatchObject({ chapterId: nextChapter!.id, hotParagraphIds: [moved.id] })
    const state = await getReadingState(created.bookId)
    expect(state).toMatchObject({ chapterId: nextChapter!.id, paragraphIndex: 4, offsetRatio: 0.5 })
    expect(state?.readUpTo[nextChapter!.id]).toBe(4)
    const comment = await db.comments.get('c')
    expect(comment?.mismatched).toBe(false)
    expect(next.find((row) => row.id === comment?.paragraphId)?.text).toBe('原来的句子，改了几个字。')
  })
})
