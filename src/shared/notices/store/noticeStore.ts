import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Notice, NoticeKind } from '../types'


const MAX_NOTICES = 5
const DEFAULT_TTL_MS = 10_000

/** Сообщения диспетчеру: общие для модулей и недолговечные. */
export const useNoticeStore = defineStore('notices', () => {
  const notices = ref<Notice[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let counter = 0

  function pushNoticeMutator(kind: NoticeKind, message: string, ttlMs: number = DEFAULT_TTL_MS): number {
    counter += 1
    const id = counter
    notices.value = [...notices.value, { id, kind, message }].slice(-MAX_NOTICES)
    // Вытесненные из стека сообщения таймеров не оставляют
    for (const [timerId, timer] of timers) {
      if (!notices.value.some((n) => n.id === timerId)) {
        clearTimeout(timer)
        timers.delete(timerId)
      }
    }
    if (ttlMs > 0) timers.set(id, setTimeout(() => dismissNoticeMutator(id), ttlMs))
    return id
  }

  function dismissNoticeMutator(id: number): void {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    notices.value = notices.value.filter((n) => n.id !== id)
  }

  return { notices, pushNoticeMutator, dismissNoticeMutator }
})
