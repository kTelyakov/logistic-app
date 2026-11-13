<script setup lang="ts">
import { computed } from 'vue'
import { useSessionStore } from '@/modules/session'
import { vehicleNameLookup, vehicleViewStore } from '@/modules/vehicles'
import QueuePanel from './components/QueuePanel.vue'
import { usePointCommands } from './composables/usePointCommands'
import { toPointViews } from './helpers/viewModel'
import { usePointsStore } from './store/pointsStore'

const points = usePointsStore()
const session = useSessionStore()
const commands = usePointCommands()

// Имена машин меняются редко; зависимость от ревизии вида пересчитывает модель при новом наборе машин
const views = computed(() => {
  void vehicleViewStore.revision.value
  return toPointViews(points.sorted, session.siteTz, vehicleNameLookup(vehicleViewStore.current()), commands.isBusy)
})
</script>

<template>
  <QueuePanel :points="views" :can-command="session.mayCommand" @set-mode="commands.setMode" />
</template>
