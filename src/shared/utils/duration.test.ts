import { describe, expect, it } from 'vitest'
import { formatCountdown, formatDuration } from './duration'

describe('formatDuration', () => {
  it('секунды, минуты, минуты с секундами', () => {
    expect(formatDuration(0)).toBe('0 с')
    expect(formatDuration(45)).toBe('45 с')
    expect(formatDuration(60)).toBe('1 мин')
    expect(formatDuration(90)).toBe('1 мин 30 с')
    expect(formatDuration(3_725)).toBe('62 мин 5 с')
  })
  it('нечисла и отрицательные значения', () => {
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(-5)).toBe('0 с')
  })
})

describe('formatCountdown', () => {
  it('мм:сс с округлением вверх: пока осталась доля секунды, показывается секунда', () => {
    expect(formatCountdown(60_000)).toBe('01:00')
    expect(formatCountdown(59_001)).toBe('01:00')
    expect(formatCountdown(59_000)).toBe('00:59')
    expect(formatCountdown(1)).toBe('00:01')
  })
  it('ноль и просрочка показываются как 00:00', () => {
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(-30_000)).toBe('00:00')
  })
})
