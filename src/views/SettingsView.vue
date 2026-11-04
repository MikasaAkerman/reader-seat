<template>
  <div class="settings">
    <VanNavBar title="设置" left-arrow @click-left="goBack" />
    <div class="settings__body">
      <VanCellGroup inset title="模型配置">
        <VanField v-model="baseUrl" label="接口地址" placeholder="https://api.deepseek.com" />
        <VanField v-model="model" label="模型名" placeholder="deepseek-chat" />
        <VanField v-model="apiKey" label="API Key" type="password" placeholder="仅保存在本地" />
      </VanCellGroup>

      <div class="settings__actions">
        <VanButton type="primary" block round :loading="saving" @click="onSave">保存</VanButton>
        <VanButton
          block
          round
          plain
          type="primary"
          :loading="testing"
          style="margin-top: 12px"
          @click="onTest"
        >
          测试连接
        </VanButton>
      </div>

      <VanCellGroup v-if="testResult" inset title="最近测试" style="margin-top: 24px">
        <VanCell title="JSON" :value="testResult.json" />
        <VanCell title="流式" :value="testResult.stream" />
        <VanCell v-if="testResult.detail" title="详情" :label="testResult.detail" />
      </VanCellGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Button as VanButton,
  Cell as VanCell,
  CellGroup as VanCellGroup,
  Field as VanField,
  NavBar as VanNavBar,
  showFailToast,
  showSuccessToast,
  showToast,
} from 'vant'
import { useSettingsStore } from '@/stores/settings'

const router = useRouter()
const settings = useSettingsStore()

const baseUrl = ref('')
const model = ref('')
const apiKey = ref('')
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ json: string; stream: string; detail?: string } | null>(null)

onMounted(async () => {
  await settings.load()
  baseUrl.value = settings.baseUrl
  model.value = settings.model
  apiKey.value = settings.apiKey
})

function goBack() {
  void router.back()
}

async function onSave() {
  saving.value = true
  try {
    await settings.save({
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      apiKey: apiKey.value.trim(),
    })
    showSuccessToast('已保存')
  } catch (err) {
    showFailToast(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function onTest() {
  testing.value = true
  testResult.value = null
  try {
    await settings.save({
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      apiKey: apiKey.value.trim(),
    })
    const result = await settings.testConnection()
    testResult.value = {
      json: result.jsonOk ? '通过' : '失败',
      stream: result.streamOk ? '通过' : '失败',
      detail: result.detail,
    }
    if (result.jsonOk && result.streamOk) {
      showSuccessToast('连通性测试通过')
    } else {
      showFailToast('连通性测试未完全通过')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '测试失败'
    testResult.value = { json: '失败', stream: '失败', detail: message }
    showToast(message)
  } finally {
    testing.value = false
  }
}
</script>

<style scoped lang="less">
.settings__body {
  padding: 16px 0 48px;
}

.settings__actions {
  padding: 24px 16px 0;
}
</style>
