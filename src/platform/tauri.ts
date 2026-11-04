import { open, save } from '@tauri-apps/plugin-dialog'
import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { type as osType } from '@tauri-apps/plugin-os'
import { LazyStore } from '@tauri-apps/plugin-store'
import type { Platform, PlatformKind } from './types'
import { exportFormat, notImplemented } from './types'

const secretStore = new LazyStore('secrets.json')

function bookPath(bookId: string): string {
  return `books/${bookId}.epub`
}

function resolveKind(): PlatformKind {
  try {
    const t = osType()
    if (t === 'android') return 'android'
    return 'desktop'
  } catch {
    return 'desktop'
  }
}

export function createTauriPlatform(): Platform {
  return {
    kind: resolveKind(),
    fetch: tauriFetch as unknown as typeof fetch,

    async pickBookFile() {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'EPUB', extensions: ['epub'] }],
      })
      if (typeof selected !== 'string') return null
      const bytes = await readFile(selected)
      const name = selected.split(/[/\\]/).pop() || 'book.epub'
      return { name, bytes }
    },
    async saveBookFile(bookId, bytes) {
      if (!(await exists('books', { baseDir: BaseDirectory.AppData }))) {
        await mkdir('books', { baseDir: BaseDirectory.AppData, recursive: true })
      }
      await writeFile(bookPath(bookId), bytes, { baseDir: BaseDirectory.AppData })
    },
    async readBookFile(bookId) {
      return readFile(bookPath(bookId), { baseDir: BaseDirectory.AppData })
    },
    async hasBookFile(bookId) {
      return exists(bookPath(bookId), { baseDir: BaseDirectory.AppData })
    },
    async deleteBookFile(bookId) {
      if (await exists(bookPath(bookId), { baseDir: BaseDirectory.AppData })) {
        await remove(bookPath(bookId), { baseDir: BaseDirectory.AppData })
      }
    },
    async exportTextFile(fileName, content) {
      if (resolveKind() === 'android') {
        await writeTextFile(fileName, content, { baseDir: BaseDirectory.Download })
        return
      }
      const format = exportFormat(fileName)
      const path = await save({
        defaultPath: fileName,
        filters: [{ name: format.name, extensions: [format.extension] }],
      })
      if (!path) return
      await writeTextFile(path, content)
    },

    async getSecret(key) {
      const value = await secretStore.get<string>(key)
      return value ?? null
    },

    async setSecret(key, value) {
      await secretStore.set(key, value)
      await secretStore.save()
    },

    keepAwake() {
      return notImplemented('keepAwake')
    },
  }
}
