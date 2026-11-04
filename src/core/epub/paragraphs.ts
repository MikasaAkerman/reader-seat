import DOMPurify from 'dompurify'
import { inertElement } from './html'

export type ParagraphKind = 'heading' | 'body'

export interface ExtractedParagraph {
  kind: ParagraphKind
  text: string
  html: string
}

const BLOCKS = new Set(['P', 'BLOCKQUOTE', 'LI', 'PRE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

function isHeading(tag: string): boolean {
  return HEADINGS.has(tag)
}

function hasBlockChild(el: Element): boolean {
  return [...el.children].some((child) => BLOCKS.has(child.tagName.toUpperCase()))
}

function parseDocument(xhtml: string): Document {
  const asXml = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml')
  if (!asXml.querySelector('parsererror')) return asXml
  return new DOMParser().parseFromString(xhtml, 'text/html')
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['ruby', 'rt', 'rp'],
  })
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

interface Piece {
  text: string
  html: string
}

function pieceFrom(nodes: Node[]): Piece {
  const holder = inertElement()
  for (const node of nodes) holder.appendChild(node.cloneNode(true))
  const html = sanitize(holder.innerHTML)
  const text = (holder.textContent ?? '').replace(/\s+/g, ' ').trim()
  return { text, html }
}

/** 连续两个及以上 br 才拆段，单独的 br 留在段内。 */
function splitByBr(el: Element): Piece[] {
  const groups: Node[][] = [[]]
  let brRun = 0
  for (const child of [...el.childNodes]) {
    if (child instanceof Element && child.tagName.toUpperCase() === 'BR') {
      brRun += 1
      if (brRun === 1) groups[groups.length - 1]?.push(child)
      if (brRun === 2) {
        const current = groups[groups.length - 1]
        const last = current?.[current.length - 1]
        if (last instanceof Element && last.tagName.toUpperCase() === 'BR') current?.pop()
        groups.push([])
      }
      continue
    }
    brRun = 0
    groups[groups.length - 1]?.push(child)
  }
  return groups.map((nodes) => pieceFrom(nodes))
}

function mergeImages(html: string, images: Element[], where: 'before' | 'after'): string {
  if (images.length === 0) return html
  const holder = inertElement()
  if (where === 'after') holder.insertAdjacentHTML('afterbegin', html)
  for (const image of images) holder.appendChild(image.cloneNode(true))
  if (where === 'before') holder.insertAdjacentHTML('beforeend', html)
  return sanitize(holder.innerHTML)
}

export function extractParagraphs(xhtml: string): ExtractedParagraph[] {
  const doc = parseDocument(xhtml)
  const root = doc.body ?? doc.documentElement
  const out: ExtractedParagraph[] = []
  const pendingImages: Element[] = []

  const pushPiece = (kind: ParagraphKind, piece: Piece) => {
    const text = piece.text
    const holder = inertElement()
    holder.innerHTML = piece.html
    const imageNodes = [...holder.querySelectorAll('img')]
    if (!text) {
      if (imageNodes.length === 0) return
      const last = out[out.length - 1]
      if (last) last.html = mergeImages(last.html, imageNodes, 'after')
      else pendingImages.push(...imageNodes)
      return
    }
    const html = mergeImages(piece.html, pendingImages, 'before')
    pendingImages.length = 0
    out.push({ kind, text, html })
  }

  const walk = (node: Node) => {
    if (!(node instanceof Element)) {
      for (const child of node.childNodes) walk(child)
      return
    }
    const tag = node.tagName.toUpperCase()
    if (tag === 'SCRIPT' || tag === 'STYLE') return
    if (tag === 'DIV' && hasBlockChild(node)) {
      for (const child of node.childNodes) walk(child)
      return
    }
    if (BLOCKS.has(tag)) {
      const kind: ParagraphKind = isHeading(tag) ? 'heading' : 'body'
      const pieces = splitByBr(node)
      const id = node.getAttribute('id')
      // 块本身的 id 是注释链接的目标，拆成段后留一个空锚点。
      const first = pieces[0]
      if (id && first) pieces[0] = { ...first, html: sanitize(`<span id="${escapeAttr(id)}"></span>`) + first.html }
      for (const piece of pieces) pushPiece(kind, piece)
      return
    }
    for (const child of node.childNodes) walk(child)
  }

  walk(root)
  return out
}
