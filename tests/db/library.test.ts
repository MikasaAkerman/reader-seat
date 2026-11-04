import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteBook, getBook, getReadingState, importBookBytes, recordProgress, updateBookSettings } from '@/db/repos/library'
import { db } from '@/db/schema'

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>巷口</dc:title>
    <dc:creator>样例作者</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`

async function epub(text: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', container)
  zip.file('OEBPS/content.opf', opf)
  zip.file(
    'OEBPS/c1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>灯灭了</h1><p>${text}</p></body></html>`,
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
      },
      {
        id: 'drop',
        batchId: 'b',
        paragraphId: dropped?.id ?? '',
        parentId: '',
        authorType: 'resident',
      },
    ])

    const updated = await importBookBytes(await epub('改过的句子。'), '巷口.epub')
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

    await deleteBook(created.bookId)
    expect(await db.books.count()).toBe(0)
    expect(await db.paragraphs.count()).toBe(0)
    expect(await db.bookFiles.count()).toBe(0)
  })

  it('does not write anything when the file is not an epub', async () => {
    await expect(importBookBytes(new Uint8Array([1, 2, 3]), 'bad.epub')).rejects.toThrow(/EPUB/)
    expect(await db.books.count()).toBe(0)
  })
})