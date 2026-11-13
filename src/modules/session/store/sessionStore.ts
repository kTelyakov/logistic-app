import type { Me } from '@dispatch/contract'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { canCommand } from '../helpers/permissions'

/** Пользователь и площадка: загружаются один раз и живут всю смену. */
export const useSessionStore = defineStore('session', () => {
  const me = ref<Me | undefined>()
  const error = ref<string | undefined>()

  const role = computed(() => me.value?.role)
  const siteTz = computed(() => me.value?.site.tz ?? 'UTC')
  const siteName = computed(() => me.value?.site.name ?? '')
  const mayCommand = computed(() => canCommand(role.value))

  function setMeMutator(next: Me): void {
    me.value = next
    error.value = undefined
  }

  function setErrorMutator(message: string): void {
    error.value = message
  }

  return { me, error, role, siteTz, siteName, mayCommand, setMeMutator, setErrorMutator }
})
