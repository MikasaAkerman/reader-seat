import { basename, decodeHref, dirname, resolveHref } from './paths'

export interface ManifestItem {
  id: string
  href: string
  mediaType: string
  properties: string
}

export interface SpineItem {
  idref: string
  href: string
  linear: boolean
}

export interface OpfPackage {
  baseDir: string
  title: string
  author: string
  translator: string
  manifest: ManifestItem[]
  spine: SpineItem[]
  navHref: string
  ncxHref: string
}

function parseXml(xml: string, label: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error(`${label} 无法解析`)
  return doc
}

function localElements(root: ParentNode, name: string): Element[] {
  return [...root.querySelectorAll('*')].filter((el) => el.localName === name)
}

function attr(el: Element, name: string): string {
  for (const attribute of el.attributes) {
    if (attribute.localName === name) return attribute.value
  }
  return ''
}

export function readRootfile(containerXml: string): string {
  const doc = parseXml(containerXml, 'container.xml')
  const root = localElements(doc, 'rootfile')[0]
  const fullPath = root ? attr(root, 'full-path') : ''
  if (!fullPath) throw new Error('EPUB 缺少 OPF 路径')
  return decodeHref(fullPath)
}

export function readOpf(opfXml: string, opfPath: string): OpfPackage {
  const doc = parseXml(opfXml, 'OPF')
  const titles = localElements(doc, 'title')
  const creators = localElements(doc, 'creator')
  const contributors = localElements(doc, 'contributor')
  const translator =
    contributors.find((el) => attr(el, 'role') === 'trl')?.textContent?.trim() ?? ''

  const manifest = localElements(doc, 'item').map((el) => ({
    id: attr(el, 'id'),
    href: resolveHref(opfPath, attr(el, 'href')),
    mediaType: attr(el, 'media-type'),
    properties: attr(el, 'properties'),
  }))
  const byId = new Map(manifest.map((item) => [item.id, item]))
  const spine = localElements(doc, 'itemref').flatMap((el) => {
    const idref = attr(el, 'idref')
    const item = byId.get(idref)
    if (!item) return []
    return [
      {
        idref,
        href: item.href,
        linear: attr(el, 'linear') !== 'no',
      },
    ]
  })

  const nav = manifest.find((item) => item.properties.split(/\s+/).includes('nav'))
  const ncx = manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml')

  return {
    baseDir: dirname(opfPath),
    title: titles[0]?.textContent?.trim() ?? '',
    author: creators[0]?.textContent?.trim() ?? '',
    translator,
    manifest,
    spine,
    navHref: nav?.href ?? '',
    ncxHref: ncx?.href ?? '',
  }
}

export function fallbackChapterTitle(href: string): string {
  return basename(href) || '未命名章节'
}
