<script setup lang="ts">
import type { PointView } from '../helpers/viewModel'

defineProps<{ points: PointView[] }>()
</script>

<template>
  <section class="panel queues" aria-label="Очереди по пунктам">
    <h2 class="panel__title">Очереди</h2>
    <p v-if="points.length === 0" class="panel__empty">Нет данных о пунктах</p>
    <article
      v-for="point in points"
      :key="point.id"
      class="point"
      :class="{ 'point--manual': point.mode === 'manual' }"
      data-testid="point"
      :data-point-id="point.id"
      :data-mode="point.mode"
    >
      <header class="point__head">
        <span class="point__name">{{ point.name }}</span>
        <span class="point__mode" :class="`point__mode--${point.mode}`">{{ point.modeLabel }}</span>
      </header>
      <div v-if="point.queue.length > 0" class="queue__scroll">
      <table class="queue">
        <thead>
          <tr>
            <th>Машина</th>
            <th>Приезд</th>
            <th>Начало</th>
            <th>Ожидание</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in point.queue"
            :key="row.key"
            data-testid="queue-item"
            :data-vehicle-id="row.vehicleId"
            :data-eta="row.etaIso"
            :data-service-start="row.serviceStartIso"
            :data-wait-s="row.waitS"
          >
            <td>{{ row.vehicleName }}</td>
            <td class="num">{{ row.eta }}</td>
            <td class="num">{{ row.serviceStart }}</td>
            <td class="num">{{ row.wait }}</td>
          </tr>
        </tbody>
      </table>
      </div>
      <p v-else class="queue__empty">Очереди нет</p>
    </article>
  </section>
</template>
