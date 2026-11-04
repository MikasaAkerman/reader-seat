import { defineStore } from 'pinia'
import { ref } from 'vue'
import { deleteBook, importBookBytes, listBookCards, type BookCard, type ImportOutcome } from '@/db/repos/library'
import { platform } from '@/platform'

export const useLibraryStore = defineStore('library', () => {
  const books = ref<BookCard[]>([])
  const error = ref('')

  async function refresh() {
    books.value = await listBookCards()
  }

  async function importBook(): Promise<ImportOutcome | null> {
    error.value = ''
    const picked = await platform.pickBookFile()
    if (!picked) return null
    try {
      const outcome = await importBookBytes(picked.bytes, picked.name)
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

  return { books, error, refresh, importBook, remove }
})
