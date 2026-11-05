import { charBigrams } from './similarity'
import { normalize } from './quote'

export interface Passage {
  text: string
  chapterTitle?: string
  score: number
}

const DEFAULT_WINDOW = 150

function windowAround(text: string, query: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const hay = normalize(text)
  const needle = normalize(query)
  const at = needle ? hay.indexOf(needle) : -1
  if (at < 0) return text.slice(0, maxChars)
  const ratio = at / Math.max(1, hay.length)
  const start = Math.max(0, Math.floor(text.length * ratio) - Math.floor(maxChars / 3))
  return text.slice(start, start + maxChars)
}

function scorePassage(query: string, text: string): number {
  const q = normalize(query)
  const t = normalize(text)
  if (!q || !t) return 0
  if (t.includes(q) || q.includes(t)) return 1 + Math.min(q.length, t.length) / 100
  const left = charBigrams(q)
  const right = charBigrams(t)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return shared / left.size
}

export function retrievePassages(query: string, corpus: Passage[], k = 3, maxChars = DEFAULT_WINDOW): Passage[] {
  const needle = query.trim()
  if (!needle || k <= 0) return []
  return [...corpus]
    .map((passage) => ({ ...passage, score: scorePassage(needle, passage.text) }))
    .filter((passage) => passage.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((passage) => ({
      ...passage,
      text: windowAround(passage.text, needle, maxChars),
    }))
}
