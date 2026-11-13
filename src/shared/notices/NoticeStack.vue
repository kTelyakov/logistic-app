<script setup lang="ts">
import type { Notice } from './noticeStore'

defineProps<{ notices: Notice[] }>()
const emit = defineEmits<{ dismiss: [id: number] }>()
</script>

<template>
  <div class="notices" aria-live="polite" data-testid="notices">
    <div
      v-for="notice in notices"
      :key="notice.id"
      class="notice"
      :class="`notice--${notice.kind}`"
      :role="notice.kind === 'info' ? 'status' : 'alert'"
      data-testid="notice"
      :data-kind="notice.kind"
    >
      <span class="notice__text">{{ notice.message }}</span>
      <button type="button" class="notice__close" aria-label="Закрыть сообщение" @click="emit('dismiss', notice.id)">×</button>
    </div>
  </div>
</template>
