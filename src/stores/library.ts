import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  deleteBook,
  importBookBytes,
  listBookCards,
  type BookCard,
  type ImportOptions,
  type ImportOutcome,
} from '@/db/repos/library'
import { platform } from '@/platform'

export const useLibraryStore = defineStore('library', () => {
  const books = ref<BookCard[]>([])
  const error = ref('')
  /** 同名同译者冲突时先把文件留着，等用户选完再导入。 */
  let held: { name: string; bytes: Uint8Array } | null = null

  async function refresh() {
    books.value = await listBookCards()
  }

  async function importBook(): Promise<ImportOutcome | null> {
    error.value = ''
    const picked = await platform.pickBookFile()
    if (!picked) return null
    return importPicked(picked)
  }

  async function resolveConflict(choice: NonNullable<ImportOptions['onConflict']> | 'cancel') {
    const picked = held
    held = null
    if (!picked || choice === 'cancel') return null
    return importPicked(picked, { onConflict: choice })
  }

  async function importPicked(picked: { name: string; bytes: Uint8Array }, options?: ImportOptions) {
    error.value = ''
    try {
      const outcome = await importBookBytes(picked.bytes, picked.name, options)
      if (outcome.status === 'conflict') held = picked
      await refresh()
      return outcome
    } catch (err) {
      error.value = err instanceof Error ? err.message : '导入失败'
      return null
    }
  }

  async function remove(bookId: string) {
    await deleteBook(bookId)
    await refresh()
  }

  return { books, error, refresh, importBook, resolveConflict, remove }
})
