/// <reference types="vitest/config" />
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { VantResolver } from '@vant/auto-import-resolver'
import Components from 'unplugin-vue-components/vite'
import { defineConfig, type Plugin } from 'vite'

function phase0FixturePlugin(): Plugin {
  const file = path.resolve('fixtures/phase0/comments.json')
  const handler = (
    req: { url?: string },
    res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: Buffer) => void },
    next: () => void,
  ) => {
    const url = req.url?.split('?')[0]
    if (url !== '/phase0/comments.json') {
      next()
      return
    }
    if (!existsSync(file)) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(readFileSync(file))
  }
  return {
    name: 'phase0-fixture',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
    generateBundle() {
      if (!existsSync(file)) return
      this.emitFile({
        type: 'asset',
        fileName: 'phase0/comments.json',
        source: readFileSync(file),
      })
    },
  }
}

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [VantResolver()],
    }),
    phase0FixturePlugin(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      less: {},
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
})
