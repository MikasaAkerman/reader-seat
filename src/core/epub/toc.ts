import { resolveHref } from './paths'

export interface TocEntry {
  href: string
  title: string
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

export function readNav(navXml: string, navPath: string): TocEntry[] {
  const asXml = new DOMParser().parseFromString(navXml, 'application/xhtml+xml')
  const doc = asXml.querySelector('parsererror')
    ? new DOMParser().parseFromString(navXml, 'text/html')
    : asXml
  const navs = localElements(doc, 'nav')
  const nav = navs.find((el) => attr(el, 'type') === 'toc') ?? navs[0]
  if (!nav) return []
  return localElements(nav, 'a')
    .map((anchor) => ({
      href: resolveHref(navPath, anchor.getAttribute('href') ?? '').split('#')[0] ?? '',
      title: (anchor.textContent ?? '').trim(),
    }))
    .filter((entry) => entry.href && entry.title)
}

export function readNcx(ncxXml: string, ncxPath: string): TocEntry[] {
  const doc = new DOMParser().parseFromString(ncxXml, 'application/xml')
  return localElements(doc, 'navPoint').flatMap((point) => {
    const label = localElements(point, 'text')[0]?.textContent?.trim() ?? ''
    const src = localElements(point, 'content')[0]
    const href = src ? resolveHref(ncxPath, attr(src, 'src')).split('#')[0] ?? '' : ''
    if (!label || !href) return []
    return [{ href, title: label }]
  })
}

export function titleFor(entries: TocEntry[], href: string, fallback: string): string {
  return entries.find((entry) => entry.href === href)?.title || fallback
}
