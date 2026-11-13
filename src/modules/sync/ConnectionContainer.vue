<script setup lang="ts">
import { computed } from 'vue'
import { useTicker } from '@/shared/utils/useTicker'
import ConnectionBadge from './components/ConnectionBadge.vue'
import { describeConnection } from './helpers/connectionStatus'
import { useConnectionStore } from './store/connectionStore'

const connection = useConnectionStore()
const now = useTicker(1000)

const status = computed(() =>
  describeConnection({
    phase: connection.phase,
    idleMs: connection.idleMs,
    // До первого статуса возраст не считаем: иначе экран сразу покажет «устарели»
    statusAgeMs: connection.statusAt === 0 ? 0 : Math.max(0, now.value - connection.statusAt),
  }),
)
</script>

<template>
  <ConnectionBadge :state="status.state" :label="status.label" />
</template>
