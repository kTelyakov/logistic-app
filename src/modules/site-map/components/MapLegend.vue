<script setup lang="ts">
import { STATE_STYLES } from '../helpers/colors'
</script>

<template>
  <ul class="legend" aria-label="Легенда схемы" data-testid="map-legend">
    <li v-for="style in STATE_STYLES" :key="style.state" class="legend__item" :data-state="style.state">
      <span class="legend__chip" :style="{ background: style.css }" aria-hidden="true" />
      {{ style.label }}
    </li>
    <li class="legend__item" data-state="stale">
      <span class="legend__chip legend__chip--stale" aria-hidden="true" />
      Нет данных больше 30 с
    </li>
  </ul>
</template>
