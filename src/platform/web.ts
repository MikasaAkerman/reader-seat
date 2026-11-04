import { getSetting, setSetting } from '@/db/repos/settings'
import type { Platform } from './types'
import { notImplemented } from './types'

export const webPlatform: Platform = {
  kind: 'web',
  fetch: globalThis.fetch.bind(globalThis),

  pickBookFile() {
    return notImplemented('pickBookFile')
  },
  saveBookFile() {
    return notImplemented('saveBookFile')
  },
  readBookFile() {
    return notImplemented('readBookFile')
  },
  deleteBookFile() {
    return notImplemented('deleteBookFile')
  },
  exportTextFile() {
    return notImplemented('exportTextFile')
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
