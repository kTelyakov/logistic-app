import { onScopeDispose, readonly, ref, type Ref } from 'vue'

/** Реактивное монотонное время (performance.now), обновляется раз в `intervalMs`. */
export function useTicker(intervalMs = 1000): Readonly<Ref<number>> {
  const now = ref(performance.now())
  const timer = setInterval(() => {
    now.value = performance.now()
  }, intervalMs)
  onScopeDispose(() => clearInterval(timer))
  return readonly(now)
}
