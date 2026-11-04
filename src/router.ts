import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'library',
      component: () => import('@/views/LibraryView.vue'),
    },
    {
      path: '/books/:bookId/setup',
      name: 'book-setup',
      component: () => import('@/views/BookSetupView.vue'),
    },
    {
      path: '/books/:bookId/read/:chapterId?',
      name: 'reader',
      component: () => import('@/views/ReaderView.vue'),
    },
    {
      path: '/books/:bookId/archive',
      name: 'archive',
      component: () => import('@/views/ArchiveView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
  ],
})

let readerHistoryPosition: number | null = null

router.afterEach((to) => {
  const position = history.state?.position
  readerHistoryPosition = to.name === 'reader' && typeof position === 'number' ? position : null
})

router.beforeEach((to, from) => {
  if (from.name !== 'reader' || to.name === 'library') return
  const position = history.state?.position
  const backToAnotherChapter =
    to.name === 'reader' &&
    readerHistoryPosition !== null &&
    typeof position === 'number' &&
    position < readerHistoryPosition
  if (to.name === 'book-setup' || backToAnotherChapter) return { name: 'library', replace: true }
})
