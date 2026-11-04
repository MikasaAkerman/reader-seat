import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { deleteSetting, getSetting, setSetting } from '@/db/repos/settings'

describe('settings repo', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('writes and reads a setting', async () => {
    await setSetting('llm.baseUrl', 'https://api.deepseek.com')
    await expect(getSetting<string>('llm.baseUrl')).resolves.toBe('https://api.deepseek.com')
  })

  it('overwrites and deletes a setting', async () => {
    await setSetting('llm.model', 'deepseek-chat')
    await setSetting('llm.model', 'deepseek-reasoner')
    await expect(getSetting<string>('llm.model')).resolves.toBe('deepseek-reasoner')
    await deleteSetting('llm.model')
    await expect(getSetting('llm.model')).resolves.toBeUndefined()
  })
})
