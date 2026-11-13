<script setup lang="ts">
import { computed, onScopeDispose } from 'vue'
import { useSessionStore } from '@/modules/session'
import { usePointsStore } from '@/modules/points'
import { useConnectionStore, useServerNow } from '@/modules/sync'
import { vehicleNameLookup, vehicleViewStore } from '@/modules/vehicles'
import CancelButton from './components/CancelButton.vue'
import DecisionFeed from './components/DecisionFeed.vue'
import { toDecisionView } from './helpers/viewModel'
import { useDecisionCommands } from './composables/useDecisionCommands'
import { useDecisionsStore } from './store/decisionsStore'

const decisions = useDecisionsStore()
const session = useSessionStore()
const points = usePointsStore()
const connection = useConnectionStore()
const serverNow = useServerNow(500)

const commands = useDecisionCommands({ vehicleName: (id) => vehicleNameLookup(vehicleViewStore.current())(id) })

const PRUNE_EVERY_MS = 60_000
const pruneTimer = setInterval(() => decisions.pruneMutator(connection.serverNow()), PRUNE_EVERY_MS)
onScopeDispose(() => clearInterval(pruneTimer))

const views = computed(() => {
  void vehicleViewStore.revision.value
  const ctx = {
    tz: session.siteTz,
    serverNowMs: serverNow.value,
    vehicleName: vehicleNameLookup(vehicleViewStore.current()),
    pointName: (id: string) => points.get(id)?.name ?? id,
  }
  return decisions.newestFirst.map((decision) => toDecisionView(decision, ctx))
})
</script>

<template>
  <DecisionFeed :decisions="views">
    <!-- Кнопок нет у наблюдателя и у решений, которые уже не ожидают -->
    <template #actions="{ decision }">
      <CancelButton
        v-if="session.mayCommand && decision.pending"
        :busy="commands.isBusy(decision.id)"
        @cancel="commands.cancel(decision.id)"
      />
    </template>
  </DecisionFeed>
</template>
