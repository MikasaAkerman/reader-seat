import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createLlmClient } from '../src/core/llm/index.ts'
import { generatePhase0 } from '../src/core/generation/phase0.ts'
import { phase0DocumentSchema } from '../src/core/generation/phase0-schema.ts'

/** 脚本展示用默认单价（每百万 tokens）。价格会变，改这里即可。 */
const PRICING = {
  inputHitPerMTok: 0.1,
  inputMissPerMTok: 1,
  outputPerMTok: 2,
}

function loadEnvFile(file: string) {
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

const root = resolve(import.meta.dirname, '..')
loadEnvFile(resolve(root, '.env.local'))

const sourcePath = resolve(root, 'fixtures/phase0/source.txt')
const outputPath = resolve(root, 'fixtures/phase0/comments.json')

if (!existsSync(sourcePath)) {
  console.error(`缺少 ${sourcePath}。请放入空行分段的原文后再运行 pnpm phase0。`)
  process.exit(1)
}

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) {
  console.error('缺少 DEEPSEEK_API_KEY。请写在 .env.local，不要提交。')
  process.exit(1)
}

const source = readFileSync(sourcePath, 'utf8')
const client = createLlmClient({
  baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  apiKey,
  model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  fetch: globalThis.fetch,
})

const { document } = await generatePhase0(source, client, {
  title: process.env.PHASE0_TITLE || '阶段 0',
  author: process.env.PHASE0_AUTHOR,
  spoilerLevel: '严格',
  pricing: PRICING,
})

const checked = phase0DocumentSchema.parse(document)
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(checked, null, 2)}\n`)

const { usage } = checked
console.log(`段落 ${checked.paragraphs.length}`)
console.log(
  `tokens prompt=${usage.promptTokens} completion=${usage.completionTokens} cacheHit=${usage.cacheHitTokens}`,
)
console.log(`费用（按脚本顶部单价）${checked.cost.toFixed(4)}`)
console.log(`已写入 ${outputPath}`)
