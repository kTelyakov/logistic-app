<script setup lang="ts">
defineProps<{ busy: boolean }>()
const emit = defineEmits<{ cancel: [] }>()
</script>

<template>
  <button type="button" class="action action--danger" data-testid="cancel-decision" :disabled="busy" :aria-busy="busy" @click="emit('cancel')">
    {{ busy ? 'Отмена…' : 'Отменить' }}
  </button>
</template>
