<template>
  <section class="talk">
    <header class="talk__head">
      <h2>本章说</h2>
    </header>

    <div v-if="hidden" class="talk__locked">
      <InfoTip text="开了「章末解锁」：读到本章最后一段，并写完下面的微评，这一章的段评和本章说才会出现。">
        <span class="talk__locked-text"><VanIcon name="lock" />读完并写下微评后解锁</span>
      </InfoTip>
    </div>
    <template v-else-if="talk">
      <div v-if="talk.hotParagraphIds.length" class="talk__block">
        <h3><VanIcon name="fire-o" />本章热段</h3>
        <button
          v-for="id in talk.hotParagraphIds"
          :key="id"
          class="talk__jump"
          type="button"
          @click="emit('jump', id)"
        >
          <span>{{ openings?.[id] || '回到这一段' }}</span>
          <VanIcon name="arrow" />
        </button>
      </div>
      <div v-if="talk.residentLines.length" class="talk__block">
        <h3><VanIcon name="comment-o" />书友一句话</h3>
        <p v-for="(line, index) in talk.residentLines" :key="index">
          <strong>{{ line.role }}</strong>
          <button
            v-if="line.folded && !openedLines[index]"
            type="button"
            class="talk__fold"
            @click="openedLines[index] = true"
          >
            可能有剧透，展开
          </button>
          <template v-else>{{ line.text }}</template>
        </p>
      </div>
      <div v-if="talk.debates.length" class="talk__block">
        <h3><VanIcon name="exchange" />争议</h3>
        <p v-for="(debate, index) in talk.debates" :key="index">
          <strong>{{ debate.topic }}</strong>{{ debate.summary }}
        </p>
      </div>
      <div v-if="talk.predictionUpdates.length" class="talk__block">
        <h3><VanIcon name="eye-o" />预测</h3>
        <p v-for="(item, index) in talk.predictionUpdates" :key="index">{{ item.status }}</p>
      </div>
      <div v-if="talk.replies.length" class="talk__block">
        <h3><VanIcon name="chat-o" />书友回应</h3>
        <p v-for="(line, index) in talk.replies" :key="index">
          <strong>{{ line.role }}</strong>{{ line.text }}
        </p>
      </div>
    </template>

    <form v-if="formOpen" class="talk__form" @submit.prevent="submit">
      <div class="talk__form-head">
        <InfoTip>
          <h3><VanIcon name="edit" />本章微评</h3>
          <template #body>
            判断：你对这一章的一句话看法。证据：支撑它的情节或原文。保留：你还拿不准、可能被后文推翻的地方。
          </template>
        </InfoTip>
        <IconButton icon="arrow-up" label="收起微评" variant="muted" @click="formOpen = false" />
      </div>
      <VanField v-model="judgment" label="判断" type="textarea" rows="1" autosize placeholder="一句话看法" />
      <VanField v-model="evidence" label="证据" type="textarea" rows="1" autosize placeholder="依据哪段情节" />
      <VanField v-model="reservation" label="保留" type="textarea" rows="1" autosize placeholder="还拿不准的地方" />
      <div class="talk__submit">
        <span v-if="replying" class="talk__replying"><VanLoading size="14px" />书友正在回应</span>
        <VanButton
          round
          size="small"
          type="primary"
          native-type="submit"
          :disabled="!judgment.trim() || !evidence.trim() || !reservation.trim()"
        >
          写好了
        </VanButton>
      </div>
    </form>
    <div v-else class="talk__collapsed">
      <button class="talk__open" type="button" @click="formOpen = true">
        <VanIcon name="edit" />
        <span>{{ micro ? '修改本章微评' : '写本章微评' }}</span>
        <VanIcon name="arrow-down" />
      </button>
      <span v-if="replying" class="talk__replying"><VanLoading size="14px" />书友正在回应</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button as VanButton, Field as VanField, Icon as VanIcon, Loading as VanLoading } from 'vant'
import IconButton from '@/components/common/IconButton.vue'
import InfoTip from '@/components/common/InfoTip.vue'
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

const openedLines = ref<Record<number, boolean>>({})
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
  margin-top: var(--rs-space-6);
  padding: var(--rs-space-4);
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-lg);
  background: var(--rs-surface);
  font-family: var(--rs-font-ui);
}

.talk__head h2 {
  margin: 0 0 var(--rs-space-2);
  font-size: var(--rs-text-lg);
  font-weight: 600;
}

.talk__fold {
  margin-left: var(--rs-space-2);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rs-accent);
  font: inherit;
  cursor: pointer;
}

.talk__locked {
  padding: var(--rs-space-2) 0 var(--rs-space-3);
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);
}

.talk__locked-text {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-1);
}

.talk__block {
  padding: var(--rs-space-3) 0;
  border-top: 1px solid var(--rs-border);

  h3 {
    display: flex;
    align-items: center;
    gap: var(--rs-space-1);
    margin: 0 0 var(--rs-space-2);
    color: var(--rs-muted);
    font-size: var(--rs-text-sm);
    font-weight: 500;

    .van-icon {
      color: var(--rs-accent);
    }
  }

  p {
    margin: var(--rs-space-1) 0 0;
    font-size: var(--rs-text-md);
    line-height: 1.65;
  }

  strong {
    margin-right: var(--rs-space-2);
    font-weight: 600;
  }
}

.talk__jump {
  display: flex;
  align-items: center;
  gap: var(--rs-space-2);
  width: 100%;
  padding: var(--rs-space-2) 0;
  border: 0;
  background: transparent;
  color: var(--rs-text);
  font-family: var(--rs-font-reading);
  font-size: var(--rs-text-md);
  text-align: left;
  cursor: pointer;

  span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .van-icon {
    color: var(--rs-muted);
  }
}

.talk__form {
  padding-top: var(--rs-space-3);
  border-top: 1px solid var(--rs-border);

  :deep(.van-cell) {
    padding: var(--rs-space-2) 0;
    background: transparent;
  }

  :deep(.van-field__label) {
    width: 3em;
    color: var(--rs-muted);
  }
}

.talk__form-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-2);

  h3 {
    display: flex;
    align-items: center;
    gap: var(--rs-space-1);
    margin: 0;
    font-size: var(--rs-text-md);
    font-weight: 600;
  }

  > :first-child {
    flex: 1;
    padding-top: 10px;
  }
}

.talk__submit {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--rs-space-3);
  margin-top: var(--rs-space-3);
}

.talk__replying {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-1);
  color: var(--rs-muted);
  font-size: var(--rs-text-sm);
}

.talk__collapsed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--rs-border);
  padding-top: var(--rs-space-2);
}

.talk__open {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-1);
  min-height: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rs-accent);
  font: inherit;
  font-size: var(--rs-text-md);
  cursor: pointer;
}
</style>
