import { describe, expect, it } from 'vitest'
import { niceGridStep } from './background'

describe('niceGridStep', () => {
  it('шаг круглый и растёт при отдалении, линии не ближе порога', () => {
    for (const scale of [3, 1, 0.5, 0.17, 0.05, 0.02]) {
      const step = niceGridStep(scale)
      expect([10, 25, 50, 100, 250, 500, 1000, 2000]).toContain(step)
      if (step !== 2000) expect(step * scale).toBeGreaterThanOrEqual(64)
    }
    expect(niceGridStep(0.02)).toBeGreaterThanOrEqual(niceGridStep(1))
  })

  it('при сильном отдалении шаг не растёт бесконечно', () => {
    expect(niceGridStep(0.0001)).toBe(2000)
  })

  it('при максимальном приближении шаг мелкий', () => {
    expect(niceGridStep(3)).toBe(25)
  })
})
