import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { initPlatform } from './platform'
import 'vant/lib/index.css'
import './styles/theme.less'

async function bootstrap() {
  await initPlatform()
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.mount('#app')
}

void bootstrap()
