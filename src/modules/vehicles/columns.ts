/** Числовые столбцы: слот машины это индекс в каждом из них. */
export interface VehicleColumns {
  x: Float32Array
  y: Float32Array
  heading: Float32Array
  speed: Float32Array
  state: Uint8Array
  /** Индекс пункта в справочнике `points` (строки меняются редко, числа можно слать каждым кадром). */
  pointIndex: Uint16Array
  /** Время last_seen в миллисекундах эпохи (float32 не хватает, сверка требует точного значения). */
  lastSeenMs: Float64Array
}

export function allocateColumns(capacity: number): VehicleColumns {
  return {
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    heading: new Float32Array(capacity),
    speed: new Float32Array(capacity),
    state: new Uint8Array(capacity),
    pointIndex: new Uint16Array(capacity),
    lastSeenMs: new Float64Array(capacity),
  }
}

export function columnsCapacity(columns: VehicleColumns): number {
  return columns.x.length
}

/** Все буферы столбцов, для передачи между потоками (transferable). */
export function columnsBuffers(columns: VehicleColumns): ArrayBuffer[] {
  return [
    columns.x.buffer,
    columns.y.buffer,
    columns.heading.buffer,
    columns.speed.buffer,
    columns.state.buffer,
    columns.pointIndex.buffer,
    columns.lastSeenMs.buffer,
  ] as ArrayBuffer[]
}

/** Копирует первые `count` элементов каждого столбца. */
export function copyColumns(from: VehicleColumns, to: VehicleColumns, count: number): void {
  to.x.set(from.x.subarray(0, count))
  to.y.set(from.y.subarray(0, count))
  to.heading.set(from.heading.subarray(0, count))
  to.speed.set(from.speed.subarray(0, count))
  to.state.set(from.state.subarray(0, count))
  to.pointIndex.set(from.pointIndex.subarray(0, count))
  to.lastSeenMs.set(from.lastSeenMs.subarray(0, count))
}
