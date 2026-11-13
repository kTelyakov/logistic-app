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
