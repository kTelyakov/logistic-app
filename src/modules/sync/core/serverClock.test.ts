import { describe, expect, it } from 'vitest'
import { ServerClock } from './serverClock'

const SERVER = Date.parse('2026-10-01T04:00:00Z')

describe('ServerClock', () => {
  it('до первого замера совпадает с временем браузера', () => {
    const clock = new ServerClock()
    expect(clock.synced).toBe(false)
    expect(clock.offsetMs).toBe(0)
    expect(clock.now(1234)).toBe(1234)
  })

  it('часы браузера отстают на 2 часа: время сервера восстанавливается', () => {
    const clock = new ServerClock()
    const wall = SERVER - 2 * 3_600_000
    clock.observe('2026-10-01T04:00:00Z', wall)
    expect(clock.synced).toBe(true)
    expect(clock.now(wall + 5_000)).toBe(SERVER + 5_000)
  })

  it('часы браузера спешат на 3 часа', () => {
    const clock = new ServerClock()
    const wall = SERVER + 3 * 3_600_000
    clock.observe('2026-10-01T04:00:00Z', wall)
    expect(clock.now(wall + 1_000)).toBe(SERVER + 1_000)
  })

  it('из нескольких замеров берётся наименьшая задержка', () => {
    const clock = new ServerClock()
    const skew = -90_000 // браузер отстаёт на 1,5 минуты
    for (const latency of [400, 80, 250, 900]) {
      clock.observe(new Date(SERVER).toISOString(), SERVER + skew + latency)
      // сообщение отправлено в момент SERVER, получено позже на latency
    }
    // оценка ошибается не больше, чем на лучшую задержку (80 мс)
    expect(Math.abs(clock.now(SERVER + skew) - SERVER)).toBeLessThanOrEqual(80)
  })

  it('старые замеры вытесняются: сдвиг следует за изменением часов', () => {
    const clock = new ServerClock(3)
    clock.observe('2026-10-01T04:00:00Z', SERVER - 1_000)
    for (let i = 0; i < 3; i++) clock.observe('2026-10-01T04:00:00Z', SERVER - 50_000)
    expect(clock.offsetMs).toBe(50_000)
  })

  it('некорректное время сервера игнорируется', () => {
    const clock = new ServerClock()
    clock.observe('не время', 1000)
    expect(clock.synced).toBe(false)
  })
})
