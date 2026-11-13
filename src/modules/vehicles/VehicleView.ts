import type { Vehicle } from '@dispatch/contract'
import type { VehicleColumns } from './columns'
import { codeToState } from './states'

/** Копия столбцов арены на момент создания кадра; уходит в основной поток как transferable. */
export interface VehicleFrame {
  count: number
  columns: VehicleColumns
}

/** Таблицы строк: слот → id и имя, справочник пунктов. Меняются редко и передаются отдельно от кадров. */
export interface VehicleTables {
  ids: readonly string[]
  names: readonly string[]
  points: readonly string[]
}

/**
 * Чтение машин в основном потоке: кадр плюс таблицы строк. Читает так же, как арена,
 * поэтому сверка и выбор машины не зависят от того, где лежат данные.
 */
export interface VehicleView {
  count: number
  columns: VehicleColumns
  tables: VehicleTables
}

export const EMPTY_VIEW: VehicleView = {
  count: 0,
  columns: {
    x: new Float32Array(0),
    y: new Float32Array(0),
    heading: new Float32Array(0),
    speed: new Float32Array(0),
    state: new Uint8Array(0),
    pointIndex: new Uint16Array(0),
    lastSeenMs: new Float64Array(0),
  },
  tables: { ids: [], names: [], points: [] },
}

export function vehicleAt(view: VehicleView, slot: number): Vehicle | undefined {
  if (slot < 0 || slot >= view.count) return undefined
  const id = view.tables.ids[slot]
  if (id === undefined) return undefined
  const c = view.columns
  return {
    vehicle_id: id,
    name: view.tables.names[slot] ?? '',
    x_m: Math.round((c.x[slot] ?? 0) * 10) / 10,
    y_m: Math.round((c.y[slot] ?? 0) * 10) / 10,
    heading_deg: c.heading[slot] ?? 0,
    speed_kmh: Math.round((c.speed[slot] ?? 0) * 10) / 10,
    state: codeToState(c.state[slot] ?? 0),
    point_id: view.tables.points[c.pointIndex[slot] ?? 0] ?? '',
    last_seen: new Date(c.lastSeenMs[slot] ?? 0).toISOString(),
  }
}

/** Слоты машин внутри прямоугольника (границы включены). Линейный проход. */
export function findInRect(view: VehicleView, minX: number, minY: number, maxX: number, maxY: number): number[] {
  const { x, y } = view.columns
  const result: number[] = []
  for (let slot = 0; slot < view.count; slot++) {
    const px = x[slot] as number
    const py = y[slot] as number
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) result.push(slot)
  }
  return result
}

/** Ближайшая к точке машина в пределах радиуса или -1. Линейный проход. */
export function findNearest(view: VehicleView, x: number, y: number, maxDistance: number): number {
  const xs = view.columns.x
  const ys = view.columns.y
  let best = -1
  let bestSquared = maxDistance * maxDistance
  for (let slot = 0; slot < view.count; slot++) {
    const dx = (xs[slot] as number) - x
    const dy = (ys[slot] as number) - y
    const squared = dx * dx + dy * dy
    if (squared <= bestSquared) {
      bestSquared = squared
      best = slot
    }
  }
  return best
}
