import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { LazyStore } from '@tauri-apps/plugin-store'
import { type as osType } from '@tauri-apps/plugin-os'
import type { Platform, PlatformKind } from './types'
import { notImplemented } from './types'

const secretStore = new LazyStore('secrets.json')

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
