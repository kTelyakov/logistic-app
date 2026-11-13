import { onScopeDispose, readonly, ref, type Ref } from 'vue'
import { useConnectionStore } from '../store/connectionStore'

/**
 * Время сервера для интерфейса (мс), обновляется раз в `intervalMs`.
 * Часы браузера напрямую не используются: только через сдвиг, оценённый по сообщениям сервера.
 */
export function useServerNow(intervalMs = 500): Readonly<Ref<number>> {
  const connection = useConnectionStore()
  const now = ref(connection.serverNow())
  const timer = setInterval(() => {
    now.value = connection.serverNow()
  }, intervalMs)
  onScopeDispose(() => clearInterval(timer))
  return readonly(now)
}
