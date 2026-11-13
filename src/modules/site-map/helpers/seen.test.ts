import { describe, expect, it } from 'vitest'
import { fillSeenSeconds, isStale, toBaseSeconds } from './seen'

const BASE = Date.parse('2026-10-01T00:00:00Z')

describe('last_seen для шейдера', () => {
  it('секунды относительно базы', () => {
    expect(toBaseSeconds(BASE + 12_345, BASE)).toBeCloseTo(12.345, 9)
    expect(toBaseSeconds(BASE - 2_000, BASE)).toBe(-2)
  })

  it('точность float32 не хуже 10 мс на сутках работы', () => {
    const out = new Float32Array(1)
    const lastSeen = new Float64Array([BASE + 86_400_000 + 123])
    fillSeenSeconds(out, lastSeen, 1, BASE)
    expect(Math.abs((out[0] as number) - 86_400.123)).toBeLessThan(0.01)
  })

  it('заполняет только первые count элементов', () => {
    const out = new Float32Array([9, 9, 9])
    fillSeenSeconds(out, new Float64Array([BASE + 1000, BASE + 2000, BASE + 3000]), 2, BASE)
    expect(Array.from(out)).toEqual([1, 2, 9])
  })

  it('устаревание: строго больше порога по времени сервера', () => {
    expect(isStale(1_000, 31_001, 30_000)).toBe(true)
    expect(isStale(1_000, 31_000, 30_000)).toBe(false) // ровно порог: ещё не устарела
    expect(isStale(1_000, 5_000, 30_000)).toBe(false)
  })
})
