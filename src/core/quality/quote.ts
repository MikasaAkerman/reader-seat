import type { BlockParagraph } from '../types'

const MIN_QUOTE = 4
const MAX_QUOTE = 30

const WRAP_PAIRS: Array<[string, string]> = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['"', '"'],
]

export function normalize(text: string): string {
  return text
    .replace(/[“”„‟「」『』"'‘’]/g, '')
    .replace(/[\u3000\s]+/g, '')
}

export function quoteLength(quote: string): number {
  return normalize(quote).length
}

export function verifyQuote(quote: string, paragraphs: BlockParagraph[], upToIndex: number): boolean {
  const needle = normalize(quote)
  if (needle.length < MIN_QUOTE || needle.length > MAX_QUOTE) return false
  const limit = Math.max(0, upToIndex)
  return paragraphs.some((paragraph) => paragraph.index <= limit && normalize(paragraph.text).includes(needle))
}

/** 正文里用「」等括起来的片段。太短或太长的不算。 */
export function extractQuoted(text: string): string[] {
  const found: string[] = []
  for (const [open, close] of WRAP_PAIRS) {
    if (open === close) {
      const parts = text.split(open)
      for (let index = 1; index < parts.length; index += 2) {
        const inner = parts[index]?.trim() ?? ''
        const size = quoteLength(inner)
        if (size >= MIN_QUOTE && size <= MAX_QUOTE) found.push(inner)
      }
      continue
    }
    let from = 0
    while (from < text.length) {
      const start = text.indexOf(open, from)
      if (start < 0) break
      const end = text.indexOf(close, start + open.length)
      if (end < 0) break
      const inner = text.slice(start + open.length, end).trim()
      const size = quoteLength(inner)
      if (size >= MIN_QUOTE && size <= MAX_QUOTE) found.push(inner)
      from = end + close.length
    }
  }
  return found
}

export function quotesInTextPass(text: string, paragraphs: BlockParagraph[], upToIndex: number): boolean {
  return extractQuoted(text).every((quote) => verifyQuote(quote, paragraphs, upToIndex))
}
