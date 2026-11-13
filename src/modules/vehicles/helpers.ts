import type { VehicleTables, VehicleView } from './VehicleView'

const cache = new WeakMap<VehicleTables, Map<string, string>>()

/**
 * Имя машины по id. Индекс строится один раз на набор таблиц (они меняются редко),
 * а не при каждом показе решения или очереди.
 */
export function vehicleNameLookup(view: VehicleView): (id: string) => string {
  const tables = view.tables
  let index = cache.get(tables)
  if (!index) {
    index = new Map<string, string>()
    for (let slot = 0; slot < tables.ids.length; slot++) {
      const id = tables.ids[slot]
      if (id !== undefined) index.set(id, tables.names[slot] ?? id)
    }
    cache.set(tables, index)
  }
  const names = index
  return (id) => names.get(id) ?? id
}

const slotCache = new WeakMap<VehicleTables, Map<string, number>>()

/** Слот машины по id (или -1). Индекс строится один раз на набор таблиц. */
export function vehicleSlotOf(view: VehicleView, id: string): number {
  const tables = view.tables
  let index = slotCache.get(tables)
  if (!index) {
    index = new Map<string, number>()
    for (let slot = 0; slot < tables.ids.length; slot++) {
      const known = tables.ids[slot]
      if (known !== undefined) index.set(known, slot)
    }
    slotCache.set(tables, index)
  }
  return index.get(id) ?? -1
}
