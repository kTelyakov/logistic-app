import type { Point, PointMessage } from '@dispatch/contract'
import { defineStore } from 'pinia'
import { computed, shallowRef, triggerRef } from 'vue'
import { sortPoints } from '../helpers/sortPoints'

/** Пункты и их очереди: общее долгоживущее состояние. Значения приходят с сервера и не пересчитываются. */
export const usePointsStore = defineStore('points', () => {
  const byId = shallowRef(new Map<string, Point>())

  const sorted = computed(() => sortPoints([...byId.value.values()]))

  function replacePointsMutator(points: readonly Point[]): void {
    byId.value = new Map(points.map((p) => [p.point_id, p]))
  }

  /** Сообщения несут полный объект после изменения: побеждает последнее. */
  function applyPointMessagesMutator(messages: readonly PointMessage[]): void {
    for (const message of messages) byId.value.set(message.data.point_id, message.data)
    triggerRef(byId)
  }

  function get(id: string): Point | undefined {
    return byId.value.get(id)
  }

  return { sorted, get, replacePointsMutator, applyPointMessagesMutator }
})
