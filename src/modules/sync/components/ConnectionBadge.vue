<script setup lang="ts">
import type { ConnectionState } from '../helpers/connectionStatus'

defineProps<{ state: ConnectionState; label: string }>()
</script>

<template>
  <span class="connection" :class="`connection--${state}`" role="status" data-testid="connection" :data-state="state">
    <span class="connection__dot" aria-hidden="true" />
    {{ label }}
  </span>
</template>
