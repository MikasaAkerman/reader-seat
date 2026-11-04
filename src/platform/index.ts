import type { Platform } from './types'
import { webPlatform } from './web'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let impl: Platform = webPlatform

/**
 * 在应用启动时调用一次。Tauri 环境下动态加载原生实现，避免浏览器打包打进 @tauri-apps。
 */
export async function initPlatform(): Promise<Platform> {
  if (isTauriRuntime()) {
    const { createTauriPlatform } = await import('./tauri')
    impl = createTauriPlatform()
  } else {
    impl = webPlatform
  }
  return impl
}

export const platform: Platform = new Proxy({} as Platform, {
  get(_target, prop, receiver) {
    const value = Reflect.get(impl, prop, receiver)
    return typeof value === 'function' ? value.bind(impl) : value
  },
})

export type { Platform, PlatformKind } from './types'
