import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractParagraphs, fnv1a32, parseEpub, relinkComments } from '@/core/epub'

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

function opf(extra = ''): string {
  return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>巷口</dc:title>
    <dc:creator>样例作者</dc:creator>
    <dc:contributor opf:role="trl">样例译者</dc:contributor>
    <dc:identifier id="bookid">sample</dc:identifier>
  </metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="pic" href="pic.jpg" media-type="image/jpeg"/>
    ${extra}
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`
}

const chapter1 = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h1>灯灭了</h1>
    <p>甲段有一句。</p>
    <p>   </p>
    <p><br/></p>
    <p>上半<br/><br/>下半</p>
    <div>
      <div>外层里的一段</div>
      <div>
        <p>嵌套的段落</p>
      </div>
    </div>
    <p><img src="pic.jpg" alt="灯"/>他看见了灯。</p>
    <p><img src="only.jpg" alt=""/></p>
  </body>
</html>`

const chapter2 = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>第二章只有这一段。</p></body></html>`

const cover = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p><img src="pic.jpg" alt="封面"/></p></body></html>`

const nav = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="c1.xhtml">灯灭了</a></li>
        <li><a href="c2.xhtml">出门</a></li>
      </ol>
    </nav>
  </body>
</html>`

async function sampleEpub(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', container)
  zip.file('OEBPS/content.opf', opf())
  zip.file('OEBPS/c1.xhtml', chapter1)
  zip.file('OEBPS/c2.xhtml', chapter2)
  zip.file('OEBPS/cover.xhtml', cover)
  zip.file('OEBPS/nav.xhtml', nav)
  zip.file('OEBPS/pic.jpg', new Uint8Array([1, 2, 3, 4]))
  return zip.generateAsync({ type: 'uint8array' })
}

describe('extractParagraphs', () => {
  it('splits p, consecutive br, drops blanks, and walks nested divs', () => {
    const paragraphs = extractParagraphs(chapter1)
    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual([
      '灯灭了',
      '甲段有一句。',
      '上半',
      '下半',
      '外层里的一段',
      '嵌套的段落',
      '他看见了灯。',
    ])
    expect(paragraphs[0]?.kind).toBe('heading')
    expect(paragraphs[6]?.html).toContain('<img')
    expect(paragraphs[6]?.html).toContain('only.jpg')
  })
})

describe('parseEpub', () => {
  it('reads metadata, spine order, anchors and a stable fingerprint', async () => {
    const bytes = await sampleEpub()
    const book = await parseEpub(bytes)
    expect(book.title).toBe('巷口')
    expect(book.author).toBe('样例作者')
    expect(book.translator).toBe('样例译者')
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['灯灭了', '出门'])
    expect(book.chapters[0]?.href).toBe('OEBPS/c1.xhtml')
    const first = book.chapters[0]?.paragraphs[0]
    expect(first?.anchor).toBe(`OEBPS/c1.xhtml#1:${fnv1a32('灯灭了')}`)
    expect(book.fingerprint).toHaveLength(64)
    expect((await parseEpub(bytes)).fingerprint).toBe(book.fingerprint)
  })
})

describe('relinkComments', () => {
  it('keeps comments whose anchor still exists and marks the rest mismatched', () => {
    const linked = relinkComments(
      [
        { id: 'old-1', anchor: 'c.xhtml#1:aaaaaaaa' },
        { id: 'old-2', anchor: 'c.xhtml#2:bbbbbbbb' },
      ],
      [{ id: 'new-1', anchor: 'c.xhtml#1:aaaaaaaa' }],
      [
        { id: 'comment-1', paragraphId: 'old-1' },
        { id: 'comment-2', paragraphId: 'old-2' },
      ],
    )
    expect(linked).toEqual([
      { id: 'comment-1', paragraphId: 'new-1', mismatched: false },
      { id: 'comment-2', paragraphId: 'old-2', mismatched: true },
    ])
  })
})
