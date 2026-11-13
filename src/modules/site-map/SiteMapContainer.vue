<script setup lang="ts">
import { STALE_AFTER_MS } from '@dispatch/contract'
import { computed, ref } from 'vue'
import { usePointsStore } from '@/modules/points'
import { formatSiteTime, useSessionStore } from '@/modules/session'
import { useServerNow } from '@/modules/sync'
import { vehicleAt, vehicleSlotOf, vehicleViewStore } from '@/modules/vehicles'
import MapLegend from './components/MapLegend.vue'
import SelectedVehicle, { type SelectedVehicleView } from './components/SelectedVehicle.vue'
import SiteCanvas from './components/SiteCanvas.vue'
import { STATE_STYLES } from './helpers/colors'
import { isStale } from './helpers/seen'
import type { PointMarker } from './helpers/background'

const points = usePointsStore()
const session = useSessionStore()
const serverNow = useServerNow(500)
const selectedId = ref<string | null>(null)

// Машины вне реактивности: вид перечитывается по счётчику ревизии
const view = computed(() => {
  void vehicleViewStore.revision.value
  return vehicleViewStore.current()
})

const markers = computed<PointMarker[]>(() =>
  points.sorted.map((p) => ({ id: p.point_id, name: p.name, x: p.x_m, y: p.y_m, mode: p.mode })),
)

const selected = computed<SelectedVehicleView | null>(() => {
  if (!selectedId.value) return null
  const v = vehicleAt(view.value, vehicleSlotOf(view.value, selectedId.value))
  if (!v) return null
  const style = STATE_STYLES.find((s) => s.state === v.state)
  return {
    id: v.vehicle_id,
    name: v.name,
    stateLabel: style?.label ?? v.state,
    stateCss: style?.css ?? 'inherit',
    speed: `${v.speed_kmh.toFixed(1)} км/ч`,
    heading: `${Math.round(v.heading_deg)}°`,
    pointName: points.get(v.point_id)?.name ?? v.point_id,
    lastSeen: formatSiteTime(v.last_seen, session.siteTz),
    // Устаревание по времени сервера, а не браузера: то же правило, что в шейдере
    stale: isStale(Date.parse(v.last_seen), serverNow.value, STALE_AFTER_MS),
  }
})
</script>

<template>
  <section class="panel map" aria-label="Схема площадки" data-testid="site-map">
    <header class="map__head">
      <h2 class="panel__title">Схема площадки</h2>
      <MapLegend />
    </header>
    <div class="map__body">
      <SiteCanvas :view="view" :points="markers" :server-now-ms="serverNow" :selected-id="selectedId" @select="selectedId = $event" />
      <SelectedVehicle :vehicle="selected" @close="selectedId = null" />
    </div>
  </section>
</template>
