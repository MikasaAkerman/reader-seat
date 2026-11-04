export type PlatformKind = 'web' | 'android' | 'desktop'

export interface Platform {
  kind: PlatformKind
  fetch: typeof fetch
  pickBookFile(): Promise<{ name: string; bytes: Uint8Array } | null>
  saveBookFile(bookId: string, bytes: Uint8Array): Promise<void>
  readBookFile(bookId: string): Promise<Uint8Array>
  deleteBookFile(bookId: string): Promise<void>
  exportTextFile(fileName: string, content: string): Promise<void>
  getSecret(key: string): Promise<string | null>
  setSecret(key: string, value: string): Promise<void>
  keepAwake(on: boolean): Promise<void>
}

export function notImplemented(method: string): never {
  throw new Error(`Platform method not implemented: ${method}`)
}
