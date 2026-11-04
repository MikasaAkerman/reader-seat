import JSZip from 'jszip'
import { fingerprintBytes, paragraphAnchor } from './hash'
import { fallbackChapterTitle, readOpf, readRootfile, type ManifestItem } from './opf'
import { extractParagraphs } from './paragraphs'
import { resolveHref } from './paths'
import { readNav, readNcx, titleFor, type TocEntry } from './toc'

export interface ParsedParagraph {
  order: number
  kind: 'heading' | 'body'
  text: string
  html: string
  anchor: string
  textHash: string
}

export interface ParsedChapter {
  href: string
  title: string
  order: number
  paragraphs: ParsedParagraph[]
}

export interface ParsedBook {
  title: string
  author: string
  translator: string
  fingerprint: string
  chapters: ParsedChapter[]
}

export interface ChapterImage {
  src: string
  mediaType: string
  bytes: Uint8Array
}

async function readText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`EPUB 缺少 ${path}`)
  return file.async('string')
}

function tocEntries(zip: JSZip, navHref: string, ncxHref: string): Promise<TocEntry[]> {
  if (navHref) return readText(zip, navHref).then((xml) => readNav(xml, navHref))
  if (ncxHref) return readText(zip, ncxHref).then((xml) => readNcx(xml, ncxHref))
  return Promise.resolve([])
}

export async function parseEpub(bytes: Uint8Array): Promise<ParsedBook> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new Error('这个文件不是 EPUB')
  }
  if (!zip.file('META-INF/container.xml') && !zip.file('meta-inf/container.xml')) {
    throw new Error('这个文件不是 EPUB')
  }
  const containerPath = zip.file('META-INF/container.xml')
    ? 'META-INF/container.xml'
    : 'meta-inf/container.xml'
  const opfPath = readRootfile(await readText(zip, containerPath))
  const opf = readOpf(await readText(zip, opfPath), opfPath)
  const toc = await tocEntries(zip, opf.navHref, opf.ncxHref)

  const chapters: ParsedChapter[] = []
  for (const item of opf.spine) {
    if (!item.linear) continue
    const file = zip.file(item.href)
    if (!file) continue
    const extracted = extractParagraphs(await file.async('string'))
    if (extracted.length === 0) continue
    const firstHeading = extracted.find((paragraph) => paragraph.kind === 'heading')
    const title = titleFor(toc, item.href, firstHeading?.text || fallbackChapterTitle(item.href))
    chapters.push({
      href: item.href,
      title,
      order: chapters.length,
      paragraphs: extracted.map((paragraph, index) => {
        const order = index + 1
        const anchor = paragraphAnchor(item.href, order, paragraph.text)
        return {
          order,
          kind: paragraph.kind,
          text: paragraph.text,
          html: paragraph.html,
          anchor,
          textHash: anchor.slice(anchor.lastIndexOf(':') + 1),
        }
      }),
    })
  }

  if (chapters.length === 0) throw new Error('这本 EPUB 里没有可阅读的章节')

  return {
    title: opf.title,
    author: opf.author,
    translator: opf.translator,
    fingerprint: await fingerprintBytes(bytes),
    chapters,
  }
}

function mediaTypeFor(manifest: ManifestItem[], path: string): string {
  return manifest.find((item) => item.href === path)?.mediaType || 'application/octet-stream'
}

export async function loadChapterImages(
  bytes: Uint8Array,
  chapterHref: string,
  srcs: string[],
): Promise<ChapterImage[]> {
  const zip = await JSZip.loadAsync(bytes)
  const containerPath = zip.file('META-INF/container.xml')
    ? 'META-INF/container.xml'
    : 'meta-inf/container.xml'
  const opfPath = readRootfile(await readText(zip, containerPath))
  const opf = readOpf(await readText(zip, opfPath), opfPath)
  const images: ChapterImage[] = []
  const seen = new Set<string>()
  for (const src of srcs) {
    if (!src || src.startsWith('data:') || src.startsWith('http:') || src.startsWith('https:')) continue
    if (seen.has(src)) continue
    seen.add(src)
    const path = resolveHref(chapterHref, src)
    const file = zip.file(path)
    if (!file) continue
    images.push({
      src,
      mediaType: mediaTypeFor(opf.manifest, path),
      bytes: await file.async('uint8array'),
    })
  }
  return images
}
