import { allocateColumns, columnsCapacity, type VehicleColumns } from './columns'

/**
 * Пул наборов буферов для кадров. Основной поток возвращает использованный кадр воркеру,
 * и тот снова записывает в него: в установившемся режиме буферы не создаются заново.
 */
export class FramePool {
  private readonly free: VehicleColumns[] = []

  /** Свободный набор буферов нужной ёмкости или undefined: тогда кадр создаст новый. */
  take(minCapacity: number): VehicleColumns | undefined {
    const at = this.free.findIndex((columns) => columnsCapacity(columns) >= minCapacity)
    if (at < 0) return undefined
    return this.free.splice(at, 1)[0]
  }

  give(columns: VehicleColumns): void {
    // Держим немного: пара кадров в полёте и один в работе
    if (this.free.length < 4) this.free.push(columns)
  }

  get size(): number {
    return this.free.length
  }

  static allocate(capacity: number): VehicleColumns {
    return allocateColumns(capacity)
  }
}
