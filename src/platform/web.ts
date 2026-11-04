import { db } from '@/db/schema'
import { getSetting, setSetting } from '@/db/repos/settings'
import type { Platform } from './types'
import { notImplemented } from './types'

export const webPlatform: Platform = {
  kind: 'web',
  fetch: globalThis.fetch.bind(globalThis),

  pickBookFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.epub,application/epub+zip'
      const finish = (value: { name: string; bytes: Uint8Array } | null) => {
        input.remove()
        resolve(value)
      }
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (!file) {
          finish(null)
          return
        }
        void file.arrayBuffer().then((buffer) => {
          finish({ name: file.name, bytes: new Uint8Array(buffer) })
        })
      })
      input.addEventListener('cancel', () => finish(null))
      document.body.appendChild(input)
      input.click()
    })
  },
  async saveBookFile(bookId, bytes) {
    await db.bookFiles.put({ bookId, bytes })
  },
  async readBookFile(bookId) {
    const row = await db.bookFiles.get(bookId)
    if (!row) throw new Error('找不到这本书的原文件')
    return row.bytes
  },
  async deleteBookFile(bookId) {
    await db.bookFiles.delete(bookId)
  },
  async exportTextFile(fileName, content) {
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  },

  async getSecret(key) {
    const value = await getSetting<string>(`secret:${key}`)
    return value ?? null
  },

  async setSecret(key, value) {
    await setSetting(`secret:${key}`, value)
  },

  keepAwake() {
    return notImplemented('keepAwake')
  },
}
