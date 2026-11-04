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
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
    {
      path: '/phase0',
      name: 'phase0',
      component: () => import('@/views/Phase0View.vue'),
    },
  ],
})
