import { describe, expect, it } from 'vitest'
import { average, fpsStats, growthMbPerHour, growthPercent, longTasksPerMinute, median, percentile, sliceSeconds } from './metrics'

describe('долгие задачи по минутам', () => {
  it('раскладывает по минутам и берёт максимум', () => {
    const rows = longTasksPerMinute(
      [
        { at: 1_000, duration: 80 },
        { at: 59_999, duration: 120 },
        { at: 60_000, duration: 55 },
        { at: 185_000, duration: 300 },
      ],
      4,
    )
    expect(rows).toEqual([
      { minute: 0, longTasks: 2, maxMs: 120 },
      { minute: 1, longTasks: 1, maxMs: 55 },
      { minute: 2, longTasks: 0, maxMs: 0 },
      { minute: 3, longTasks: 1, maxMs: 300 },
    ])
  })

  it('задачи за пределами замера игнорируются', () => {
    expect(longTasksPerMinute([{ at: 600_001, duration: 90 }], 10).every((r) => r.longTasks === 0)).toBe(true)
  })
})

describe('перцентили и FPS', () => {
  it('перцентиль с интерполяцией', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30)
    expect(percentile([10, 20, 30, 40, 50], 0)).toBe(10)
    expect(percentile([10, 20, 30, 40, 50], 100)).toBe(50)
    expect(percentile([0, 100], 25)).toBe(25)
    expect(Number.isNaN(percentile([], 50))).toBe(true)
  })

  it('5-й перцентиль берёт худшие секунды: редкие провалы видны, среднее их прячет', () => {
    const fps = [...Array.from({ length: 90 }, () => 60), ...Array.from({ length: 10 }, () => 5)]
    const stats = fpsStats(fps)
    expect(stats.average).toBeCloseTo(54.5, 5)
    expect(stats.p5).toBeLessThan(30)
    expect(stats.min).toBe(5)
    expect(stats.seconds).toBe(100)
  })

  it('ровные 60 кадров', () => {
    expect(fpsStats(Array.from({ length: 50 }, () => 60))).toMatchObject({ average: 60, p5: 60, min: 60 })
  })

  it('среднее и медиана', () => {
    expect(average([1, 2, 3, 4])).toBe(2.5)
    expect(median([5, 1, 9])).toBe(5)
    expect(Number.isNaN(average([]))).toBe(true)
  })

  it('окно секунд', () => {
    expect(sliceSeconds([1, 2, 3, 4, 5], 2)).toEqual([3, 4, 5])
    expect(sliceSeconds([1, 2, 3, 4, 5], 1, 3)).toEqual([2, 3])
  })
})

describe('рост памяти', () => {
  it('проценты от базы', () => {
    expect(growthPercent(100, 108)).toBeCloseTo(8, 9)
    expect(growthPercent(100, 90)).toBeCloseTo(-10, 9)
    expect(Number.isNaN(growthPercent(0, 5))).toBe(true)
  })

  it('мегабайты в час по двум точкам', () => {
    // +1 МБ за 10 минут это 6 МБ/ч
    expect(growthMbPerHour(10e6, 11e6, 600_000)).toBeCloseTo(6, 9)
    expect(Number.isNaN(growthMbPerHour(1, 2, 0))).toBe(true)
  })
})
