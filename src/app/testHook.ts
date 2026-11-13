import type { Vehicle } from '@dispatch/contract'
import { vehicleAt, vehicleViewStore } from '@/modules/vehicles'

/**
 * Шов для e2e-тестов (контракт в tests/e2e/README.md). Схема рисуется на canvas, поэтому машин в DOM нет:
 * тесты читают их через этот хук. Только чтение, на работу экрана не влияет.
 */
export interface DispatchTestHook {
  /** Последний seq, содержимое которого уже применено на экране. */
  seq(): number
  vehicles(): Vehicle[]
}

declare global {
  interface Window {
    __dispatch?: DispatchTestHook
  }
}

export function installTestHook(appliedSeq: () => number): void {
  window.__dispatch = {
    seq: appliedSeq,
    vehicles() {
      const view = vehicleViewStore.current()
      const result: Vehicle[] = []
      for (let slot = 0; slot < view.count; slot++) {
        const vehicle = vehicleAt(view, slot)
        if (vehicle) result.push(vehicle)
      }
      return result
    },
  }
}
