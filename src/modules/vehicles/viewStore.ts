import { shallowRef, type ShallowRef } from 'vue'
import { EMPTY_VIEW, type VehicleView } from './VehicleView'

/**
 * Текущий вид машин в основном потоке. Намеренно вне Pinia и вне реактивности: 10–15 тысяч машин,
 * обновляются каждым пакетом. Реактивен только счётчик ревизии, по нему перерисовываются подписчики.
 */
export interface VehicleViewStore {
  current(): VehicleView
  setViewMutator(view: VehicleView): void
  readonly revision: ShallowRef<number>
}

export function createVehicleViewStore(): VehicleViewStore {
  let view: VehicleView = EMPTY_VIEW
  const revision = shallowRef(0)
  return {
    current: () => view,
    setViewMutator(next) {
      view = next
      revision.value += 1
    },
    revision,
  }
}

export const vehicleViewStore = createVehicleViewStore()
