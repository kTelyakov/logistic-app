<script setup lang="ts">
import { computed } from 'vue'
import { useSessionStore } from '@/modules/session'
import { vehicleNameLookup, vehicleViewStore } from '@/modules/vehicles'
import QueuePanel from './components/QueuePanel.vue'
import { toPointViews } from './helpers/viewModel'
import { usePointsStore } from './store/pointsStore'

const points = usePointsStore()
const session = useSessionStore()

// Имена машин меняются редко; зависимость от ревизии вида пересчитывает модель при новом наборе машин
const views = computed(() => {
  void vehicleViewStore.revision.value
  return toPointViews(points.sorted, session.siteTz, vehicleNameLookup(vehicleViewStore.current()))
})
</script>

<template>
  <QueuePanel :points="views" />
</template>
