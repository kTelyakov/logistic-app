<script setup lang="ts">
import type { DecisionView } from '../helpers/viewModel'

defineProps<{ decision: DecisionView }>()
</script>

<template>
  <li
    class="decision"
    :class="`decision--${decision.status}`"
    data-testid="decision"
    :data-decision-id="decision.id"
    :data-status="decision.status"
    :data-version="decision.version"
  >
    <div class="decision__row">
      <span class="decision__vehicle">{{ decision.vehicleName }}</span>
      <span class="decision__route">{{ decision.route }}</span>
      <span class="decision__gain" title="Выигрыш по оценке сервера">выигрыш {{ decision.gain }}</span>
    </div>
    <p class="decision__reason" data-testid="decision-reason">{{ decision.reason }}</p>
    <div class="decision__row decision__meta">
      <span class="decision__time">{{ decision.createdAt }}</span>
      <span class="decision__status" data-testid="decision-status">{{ decision.statusLabel }}</span>
      <span v-if="decision.pending" class="decision__countdown" data-testid="decision-countdown" title="До исполнения">
        {{ decision.countdown }}
      </span>
      <slot name="actions" :decision="decision" />
    </div>
  </li>
</template>
