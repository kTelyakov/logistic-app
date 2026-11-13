<script setup lang="ts">
import type { PointMode } from '@dispatch/contract'

defineProps<{ mode: PointMode; busy: boolean }>()
const emit = defineEmits<{ change: [mode: PointMode] }>()
</script>

<template>
  <div class="mode-switch" role="group" aria-label="Режим пункта" :aria-busy="busy">
    <button
      type="button"
      class="mode-switch__option"
      :class="{ 'mode-switch__option--active': mode === 'auto' }"
      data-testid="mode-auto"
      :disabled="busy || mode === 'auto'"
      :aria-pressed="mode === 'auto'"
      @click="emit('change', 'auto')"
    >
      Авто
    </button>
    <button
      type="button"
      class="mode-switch__option"
      :class="{ 'mode-switch__option--active': mode === 'manual' }"
      data-testid="mode-manual"
      :disabled="busy || mode === 'manual'"
      :aria-pressed="mode === 'manual'"
      @click="emit('change', 'manual')"
    >
      Ручной
    </button>
  </div>
</template>
