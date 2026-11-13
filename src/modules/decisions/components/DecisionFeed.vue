<script setup lang="ts">
import type { DecisionView } from '../helpers/viewModel'
import DecisionItem from './DecisionItem.vue'

defineProps<{ decisions: DecisionView[] }>()
</script>

<template>
  <section class="panel decisions" aria-label="Лента решений">
    <h2 class="panel__title">Решения <span class="panel__count">{{ decisions.length }}</span></h2>
    <p v-if="decisions.length === 0" class="panel__empty">Решений за последний час нет</p>
    <ul v-else class="decisions__list">
      <DecisionItem v-for="decision in decisions" :key="decision.id" :decision="decision">
        <template #actions="slotProps">
          <slot name="actions" v-bind="slotProps" />
        </template>
      </DecisionItem>
    </ul>
  </section>
</template>
