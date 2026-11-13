import type { Vehicle } from '@dispatch/contract'
import { allocateColumns, columnsCapacity, copyColumns, type VehicleColumns } from './columns'
import { codeToState, stateToCode } from './states'
import type { VehicleFrame } from './VehicleView'

const INITIAL_CAPACITY = 1024

/**
 * Хранилище машин без объекта на машину: слот на машину и столбцы типизированных массивов.
 * Владелец записи — воркер синхронизации; основной поток читает кадры (см. `VehicleView`).
 */
export class VehicleArena {
  columns: VehicleColumns
  /** Слот → id и имя. Строки нужны при выборе машины и в сверке, а не при отрисовке. */
  readonly ids: string[] = []
  readonly names: string[] = []
  /** Справочник пунктов: в столбце хранится индекс, а не строка. */
  readonly points: string[] = []
  private readonly pointCodes = new Map<string, number>()
  private readonly slots = new Map<string, number>()
  private size = 0
  /** Растёт при появлении новых машин, нового пункта или очистке: основному потоку нужно заново получить таблицы строк. */
  private idsRevision = 0

  constructor(initialCapacity = INITIAL_CAPACITY) {
    this.columns = allocateColumns(Math.max(1, initialCapacity))
  }

  get count(): number {
    return this.size
  }

  get capacity(): number {
    return columnsCapacity(this.columns)
  }

  get tablesRevision(): number {
    return this.idsRevision
  }

  slotOf(id: string): number | undefined {
    return this.slots.get(id)
  }

  /** Записывает машину и возвращает её слот. Повторная запись той же машины слот не меняет. */
  upsert(vehicle: Vehicle): number {
    let slot = this.slots.get(vehicle.vehicle_id)
    if (slot === undefined) {
      slot = this.size
      if (slot >= this.capacity) this.grow(this.capacity * 2)
      this.size += 1
      this.slots.set(vehicle.vehicle_id, slot)
      this.ids[slot] = vehicle.vehicle_id
      this.names[slot] = vehicle.name
      this.idsRevision += 1
    }
    const c = this.columns
    c.x[slot] = vehicle.x_m
    c.y[slot] = vehicle.y_m
    c.heading[slot] = vehicle.heading_deg
    c.speed[slot] = vehicle.speed_kmh
    c.state[slot] = stateToCode(vehicle.state)
    c.pointIndex[slot] = this.pointCode(vehicle.point_id)
    c.lastSeenMs[slot] = Date.parse(vehicle.last_seen)
    return slot
  }

  upsertMany(vehicles: readonly Vehicle[]): void {
    for (const vehicle of vehicles) this.upsert(vehicle)
  }

  /** Полная очистка (замена состояния снимком). Ёмкость сохраняется. */
  clear(): void {
    this.slots.clear()
    this.ids.length = 0
    this.names.length = 0
    this.size = 0
    this.idsRevision += 1
  }

  /** Машина в исходном виде контракта: координаты округляются до 0,1 м. */
  toVehicle(slot: number): Vehicle | undefined {
    const id = this.ids[slot]
    if (id === undefined || slot >= this.size) return undefined
    const c = this.columns
    return {
      vehicle_id: id,
      name: this.names[slot] ?? '',
      x_m: Math.round((c.x[slot] ?? 0) * 10) / 10,
      y_m: Math.round((c.y[slot] ?? 0) * 10) / 10,
      heading_deg: c.heading[slot] ?? 0,
      speed_kmh: Math.round((c.speed[slot] ?? 0) * 10) / 10,
      state: codeToState(c.state[slot] ?? 0),
      point_id: this.points[c.pointIndex[slot] ?? 0] ?? '',
      last_seen: new Date(c.lastSeenMs[slot] ?? 0).toISOString(),
    }
  }

  /**
   * Копия столбцов на момент вызова в `target` (если хватает места) или в новых буферах.
   * Кадр не зависит от дальнейших записей в арену.
   */
  createFrame(target?: VehicleColumns): VehicleFrame {
    const columns = target && columnsCapacity(target) >= this.size ? target : allocateColumns(this.growTo(this.size))
    copyColumns(this.columns, columns, this.size)
    return { count: this.size, columns }
  }

  private pointCode(pointId: string): number {
    let code = this.pointCodes.get(pointId)
    if (code === undefined) {
      code = this.points.length
      this.points.push(pointId)
      this.pointCodes.set(pointId, code)
      this.idsRevision += 1
    }
    return code
  }

  private growTo(needed: number): number {
    let capacity = INITIAL_CAPACITY
    while (capacity < needed) capacity *= 2
    return capacity
  }

  private grow(capacity: number): void {
    const next = allocateColumns(capacity)
    copyColumns(this.columns, next, this.size)
    this.columns = next
  }
}
