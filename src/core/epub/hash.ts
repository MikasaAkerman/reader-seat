/** FNV-1a 32 位，输出 8 位十六进制。对去掉空白后的段落文本同步计算。 */
export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function compactText(text: string): string {
  return text.replace(/\s+/g, '')
}

export function paragraphAnchor(chapterHref: string, index: number, text: string): string {
  return `${chapterHref}#${index}:${fnv1a32(compactText(text))}`
}

export async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
