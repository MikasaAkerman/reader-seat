<template>
  <section class="talk">
    <h2>本章说</h2>
    <p v-if="hidden" class="talk__note">读完这一章，并写下微评之后，再看段评和本章说。</p>
    <template v-else-if="talk">
      <div v-if="talk.hotParagraphIds.length" class="talk__block">
        <h3>本章热段</h3>
        <button v-for="id in talk.hotParagraphIds" :key="id" type="button" @click="emit('jump', id)">
          {{ openings?.[id] || '回到这一段' }}
        </button>
      </div>
      <div v-if="talk.residentLines.length" class="talk__block">
        <h3>书友一句话</h3>
        <p v-for="(line, index) in talk.residentLines" :key="index">{{ line.role }}：{{ line.text }}</p>
      </div>
      <div v-if="talk.debates.length" class="talk__block">
        <h3>争议</h3>
        <p v-for="(debate, index) in talk.debates" :key="index">{{ debate.topic }}：{{ debate.summary }}</p>
      </div>
      <div v-if="talk.predictionUpdates.length" class="talk__block">
        <h3>预测</h3>
        <p v-for="(item, index) in talk.predictionUpdates" :key="index">{{ item.status }}</p>
      </div>
      <div v-if="talk.replies.length" class="talk__block">
        <h3>书友回应</h3>
        <p v-for="(line, index) in talk.replies" :key="index">{{ line.role }}：{{ line.text }}</p>
      </div>
    </template>
    <form v-if="formOpen" class="talk__form" @submit.prevent="submit">
      <div class="talk__head">
        <h3>本章微评</h3>
        <button type="button" @click="formOpen = false">关闭</button>
      </div>
      <label>判断 <textarea v-model="judgment" rows="2" /></label>
      <label>证据 <textarea v-model="evidence" rows="2" /></label>
      <label>保留 <textarea v-model="reservation" rows="2" /></label>
      <button type="submit" :disabled="!judgment.trim() || !evidence.trim() || !reservation.trim()">写好了</button>
      <p v-if="replying">书友正在回应。</p>
    </form>
    <div v-else class="talk__form">
      <button type="button" @click="formOpen = true">本章微评</button>
      <p v-if="replying">书友正在回应。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ChapterTalkRow } from '@/db/schema'

const props = defineProps<{
  hidden: boolean
  replying: boolean
  talk: ChapterTalkRow | null
  micro: { judgment: string; evidence: string; reservation: string } | null
  openings?: Record<string, string>
  defaultOpen?: boolean
}>()

const emit = defineEmits<{
  jump: [paragraphId: string]
  submit: [payload: { judgment: string; evidence: string; reservation: string }]
}>()

const judgment = ref('')
const evidence = ref('')
const reservation = ref('')
const formOpen = ref(props.defaultOpen !== false)

watch(
  () => props.defaultOpen,
  (open) => {
    formOpen.value = open !== false
  },
)

watch(
  () => props.micro,
  (micro) => {
    judgment.value = micro?.judgment ?? ''
    evidence.value = micro?.evidence ?? ''
    reservation.value = micro?.reservation ?? ''
  },
  { immediate: true },
)

function submit() {
  emit('submit', {
    judgment: judgment.value.trim(),
    evidence: evidence.value.trim(),
    reservation: reservation.value.trim(),
  })
}
</script>

<style scoped lang="less">
.talk {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--rs-border, #e7e5e4);
}

.talk__note,
.talk__block p {
  color: var(--rs-muted, #78716c);
}

.talk__head {
  display: flex;
  align-items: center;
  justify-content: space-between;

  h3 {
    margin: 0;
  }

  button {
    border: 0;
    background: transparent;
    color: var(--rs-muted, #78716c);
  }
}

.talk__form {
  display: flex;
  flex-direction: column;
  gap: 8px;

  textarea {
    width: 100%;
  }
}
</style>
