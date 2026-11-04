export function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

export function resolveHref(baseFile: string, href: string): string {
  const clean = decodeHref(href.split('#')[0] ?? '')
  const stack = dirname(baseFile) ? dirname(baseFile).split('/') : []
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(decodeHref(part))
  }
  return stack.join('/')
}

export function decodeHref(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function basename(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.[^.]+$/, '')
}
