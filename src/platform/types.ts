export type PlatformKind = 'web' | 'android' | 'desktop'

export interface Platform {
  kind: PlatformKind
  fetch: typeof fetch
  pickBookFile(): Promise<{ name: string; bytes: Uint8Array } | null>
  saveBookFile(bookId: string, bytes: Uint8Array): Promise<void>
  readBookFile(bookId: string): Promise<Uint8Array>
  hasBookFile(bookId: string): Promise<boolean>
  deleteBookFile(bookId: string): Promise<void>
  exportTextFile(fileName: string, content: string): Promise<void>
  getSecret(key: string): Promise<string | null>
  setSecret(key: string, value: string): Promise<void>
  keepAwake(on: boolean): Promise<void>
}

/** 导出文件按扩展名给保存对话框的过滤器和 MIME 类型。 */
export function exportFormat(fileName: string): { name: string; extension: string; mime: string } {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'md') return { name: 'Markdown', extension, mime: 'text/markdown;charset=utf-8' }
  if (extension === 'json') return { name: 'JSON', extension, mime: 'application/json' }
  return { name: '文本', extension: extension || 'txt', mime: 'text/plain;charset=utf-8' }
}

export function notImplemented(method: string): never {
  throw new Error(`Platform method not implemented: ${method}`)
}
