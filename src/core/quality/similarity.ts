const DEFAULT_THRESHOLD = 0.45
const CONTAINMENT_THRESHOLD = 0.72

export function stripForCompare(text: string, extras: string[] = []): string {
  let next = text
  const sorted = [...extras].filter(Boolean).sort((a, b) => b.length - a.length)
  for (const extra of sorted) next = next.split(extra).join('')
  return next.replace(/[\p{P}\p{S}\s]/gu, '')
}

export function charBigrams(text: string): Set<string> {
  const grams = new Set<string>()
  if (text.length <= 1) {
    if (text) grams.add(text)
    return grams
  }
  for (let index = 0; index < text.length - 1; index++) grams.add(text.slice(index, index + 2))
  return grams
}

function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0
  for (const gram of a) if (b.has(gram)) count += 1
  return count
}

export function jaccard(a: string, b: string): number {
  const left = charBigrams(a)
  const right = charBigrams(b)
  if (left.size === 0 && right.size === 0) return 1
  const shared = overlap(left, right)
  const union = left.size + right.size - shared
  return union === 0 ? 0 : shared / union
}

/** 较短一方有多少二元组落在较长一方里。 */
export function containment(a: string, b: string): number {
  const left = charBigrams(a)
  const right = charBigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  return overlap(small, large) / small.size
}

export function isNearDuplicate(
  text: string,
  corpus: string[],
  threshold = DEFAULT_THRESHOLD,
  extras: string[] = [],
): boolean {
  const a = stripForCompare(text, extras)
  if (a.length < 4) return false
  for (const other of corpus) {
    const b = stripForCompare(other, extras)
    if (b.length < 4) continue
    if (jaccard(a, b) >= threshold || containment(a, b) >= CONTAINMENT_THRESHOLD) return true
  }
  return false
}

/** 语料去重后的二元组覆盖率，越接近 1 越多样。 */
export function diversityScore(texts: string[], extras: string[] = []): number {
  const unique = new Set<string>()
  let total = 0
  for (const text of texts) {
    const grams = charBigrams(stripForCompare(text, extras))
    total += grams.size
    for (const gram of grams) unique.add(gram)
  }
  if (total === 0) return 0
  return unique.size / total
}
