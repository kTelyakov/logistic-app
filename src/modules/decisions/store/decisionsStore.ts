import type { Decision, DecisionMessage } from '@dispatch/contract'
import { defineStore } from 'pinia'
import { computed, shallowRef, triggerRef } from 'vue'
import { isWithinWindow, sortNewestFirst } from '../helpers/window'

/** Решения за последний час по времени сервера: общее состояние, не растёт без границы. */
export const useDecisionsStore = defineStore('decisions', () => {
  const byId = shallowRef(new Map<string, Decision>())

  const newestFirst = computed(() => sortNewestFirst([...byId.value.values()]))
  const size = computed(() => byId.value.size)

  function replaceDecisionsMutator(decisions: readonly Decision[]): void {
    byId.value = new Map(decisions.map((d) => [d.decision_id, d]))
  }

  /** Сообщения несут полный объект: побеждает последнее. Устаревшую версию не принимаем поверх новой. */
  function applyDecisionMessagesMutator(messages: readonly DecisionMessage[]): void {
    for (const message of messages) {
      const current = byId.value.get(message.data.decision_id)
      if (current && current.version > message.data.version) continue
      byId.value.set(message.data.decision_id, message.data)
    }
    triggerRef(byId)
  }

  /** Принимает ответ сервера на команду (в том числе 409 с актуальным решением). */
  function applyServerDecisionMutator(decision: Decision): void {
    const current = byId.value.get(decision.decision_id)
    if (current && current.version > decision.version) return
    byId.value.set(decision.decision_id, decision)
    triggerRef(byId)
  }

  /** Удаляет решения старше часа по времени сервера. */
  function pruneMutator(serverNowMs: number): void {
    let removed = false
    for (const [id, decision] of byId.value) {
      if (!isWithinWindow(decision, serverNowMs)) {
        byId.value.delete(id)
        removed = true
      }
    }
    if (removed) triggerRef(byId)
  }

  function get(id: string): Decision | undefined {
    return byId.value.get(id)
  }

  return { newestFirst, size, get, replaceDecisionsMutator, applyDecisionMessagesMutator, applyServerDecisionMutator, pruneMutator }
})
