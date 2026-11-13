<script setup lang="ts">
export interface SelectedVehicleView {
  id: string
  name: string
  stateLabel: string
  stateCss: string
  speed: string
  heading: string
  pointName: string
  lastSeen: string
  stale: boolean
}

defineProps<{ vehicle: SelectedVehicleView | null }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <aside v-if="vehicle" class="selected" data-testid="selected-vehicle" :data-vehicle-id="vehicle.id">
    <header class="selected__head">
      <span class="selected__name">{{ vehicle.name }}</span>
      <span class="selected__state" :style="{ color: vehicle.stateCss }">{{ vehicle.stateLabel }}</span>
      <button type="button" class="notice__close" aria-label="Снять выбор" @click="emit('close')">×</button>
    </header>
    <dl class="selected__grid">
      <dt>Скорость</dt>
      <dd>{{ vehicle.speed }}</dd>
      <dt>Курс</dt>
      <dd>{{ vehicle.heading }}</dd>
      <dt>Пункт</dt>
      <dd>{{ vehicle.pointName }}</dd>
      <dt>Данные от</dt>
      <dd data-testid="selected-last-seen">
        {{ vehicle.lastSeen }}
        <span v-if="vehicle.stale" class="selected__stale" data-testid="selected-stale">устарели</span>
      </dd>
    </dl>
  </aside>
</template>
