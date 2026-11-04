let inert: Document | null = null

/**
 * 不属于页面的文档：在这里设 innerHTML 不会加载图片、不会触发 onerror 之类的处理器。
 * 书里的 HTML 在消毒之前只能放进这里。
 */
export function inertElement(tag = 'div'): HTMLElement {
  inert ??= document.implementation.createHTMLDocument('')
  return inert.createElement(tag)
}

export function imageSrcs(html: string): string[] {
  const holder = inertElement()
  holder.innerHTML = html
  return [...holder.querySelectorAll('img')]
    .map((img) => img.getAttribute('src') ?? '')
    .filter((src) => src.length > 0)
}

export function rewriteImages(html: string, map: Map<string, string>): string {
  const holder = inertElement()
  holder.innerHTML = html
  for (const img of holder.querySelectorAll('img')) {
    const src = img.getAttribute('src')
    const next = src ? map.get(src) : undefined
    if (next) img.setAttribute('src', next)
  }
  return holder.innerHTML
}

export type BookLink =
  | { kind: 'external'; href: string }
  | { kind: 'internal'; path: string; fragment: string }

const BASE = 'epub://book/'

/** 把章节里的链接解析成书内路径（相对 OPF 所在目录，和章节 href 一致）或外链。 */
export function resolveBookLink(chapterHref: string, href: string): BookLink | null {
  const raw = href.trim()
  if (!raw) return null
  if (/^(https?|mailto|tel):/i.test(raw)) return { kind: 'external', href: raw }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  try {
    const url = new URL(raw, BASE + chapterHref.split('#')[0])
    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    return { kind: 'internal', path, fragment: decodeURIComponent(url.hash.replace(/^#/, '')) }
  } catch {
    return null
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 在一章的段落里找注释目标：带这个 id 的元素所在的段；没有片段时取第一段。 */
export function findLinkTarget<T extends { html: string }>(paragraphs: T[], fragment: string): T | undefined {
  if (!fragment) return paragraphs[0]
  const pattern = new RegExp(`\\s(id|name)=["']${escapeRegExp(fragment)}["']`)
  return paragraphs.find((paragraph) => pattern.test(paragraph.html))
}
