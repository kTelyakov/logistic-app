export interface LongTask {
  /** Время начала от старта замера, мс. */
  at: number
  duration: number
}

export interface MinuteRow {
  minute: number
  longTasks: number
  maxMs: number
}

/** Долгие задачи по минутам: минута 0 это первые 60 секунд от старта замера. */
export function longTasksPerMinute(tasks: readonly LongTask[], minutes: number): MinuteRow[] {
  const rows: MinuteRow[] = Array.from({ length: minutes }, (_, minute) => ({ minute, longTasks: 0, maxMs: 0 }))
  for (const task of tasks) {
    const row = rows[Math.floor(task.at / 60_000)]
    if (!row) continue
    row.longTasks += 1
    row.maxMs = Math.max(row.maxMs, task.duration)
  }
  return rows
}

/** Перцентиль p (0..100) по линейной интерполяции между соседними значениями. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (p / 100) * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  const lowValue = sorted[low] as number
  const highValue = sorted[high] as number
  return lowValue + (highValue - lowValue) * (rank - low)
}

export const average = (values: readonly number[]): number => (values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length)

export function median(values: readonly number[]): number {
  return percentile(values, 50)
}

export interface FpsStats {
  average: number
  p5: number
  min: number
  seconds: number
}

/** Кадры в секунду по секундным окнам: среднее и 5-й перцентиль (худшие 5 % секунд). */
export function fpsStats(framesPerSecond: readonly number[]): FpsStats {
  return {
    average: average(framesPerSecond),
    p5: percentile(framesPerSecond, 5),
    min: framesPerSecond.length === 0 ? Number.NaN : Math.min(...framesPerSecond),
    seconds: framesPerSecond.length,
  }
}

/** Рост в процентах от базовой точки. */
export function growthPercent(base: number, end: number): number {
  return base === 0 ? Number.NaN : ((end - base) / base) * 100
}

/** Скорость роста, МБ в час, по двум точкам во времени. */
export function growthMbPerHour(baseBytes: number, endBytes: number, elapsedMs: number): number {
  return elapsedMs <= 0 ? Number.NaN : ((endBytes - baseBytes) / 1e6) * (3_600_000 / elapsedMs)
}

/** Разбивает массив отсчётов по секундам окна [fromSecond, toSecond). */
export function sliceSeconds(perSecond: readonly number[], fromSecond: number, toSecond: number = perSecond.length): number[] {
  return perSecond.slice(fromSecond, toSecond)
}
