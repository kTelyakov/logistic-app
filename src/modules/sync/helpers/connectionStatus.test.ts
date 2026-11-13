import { describe, expect, it } from 'vitest'
import { describeConnection, STALE_AFTER_MS } from './connectionStatus'

const live = (idleMs: number, statusAgeMs = 0) => describeConnection({ phase: 'live', idleMs, statusAgeMs })

describe('describeConnection', () => {
  it('порог устаревания: три интервала heartbeat', () => {
    expect(STALE_AFTER_MS).toBe(15_000)
  })

  it('подключено: сообщения идут', () => {
    expect(live(0)).toEqual({ state: 'connected', label: 'Подключено' })
    expect(live(5_200)).toMatchObject({ state: 'connected' })
  })

  it('данные устарели: тишина дольше порога, граница не включена', () => {
    expect(live(STALE_AFTER_MS)).toMatchObject({ state: 'connected' })
    expect(live(STALE_AFTER_MS + 1)).toEqual({ state: 'stale', label: 'Данные устарели' })
  })

  it('возраст самого статуса тоже считается: воркер завис, статусов нет', () => {
    expect(live(2_000, 13_000)).toMatchObject({ state: 'connected' }) // 15 000: граница не включена
    expect(live(2_000, 13_001)).toMatchObject({ state: 'stale' })
  })

  it('обрыв и повторная загрузка снимка: переподключение', () => {
    expect(describeConnection({ phase: 'reconnecting', idleMs: 0, statusAgeMs: 0 })).toEqual({ state: 'reconnecting', label: 'Переподключение' })
    expect(describeConnection({ phase: 'resyncing', idleMs: 0, statusAgeMs: 0 })).toMatchObject({ state: 'reconnecting' })
  })

  it('до первого снимка: подключение', () => {
    expect(describeConnection({ phase: 'idle', idleMs: 0, statusAgeMs: 0 })).toEqual({ state: 'connecting', label: 'Подключение' })
    expect(describeConnection({ phase: 'loading', idleMs: 0, statusAgeMs: 0 })).toMatchObject({ state: 'connecting' })
  })

  it('при переподключении «устарели» не перекрывает его: сообщаем, что идёт восстановление', () => {
    expect(describeConnection({ phase: 'reconnecting', idleMs: 60_000, statusAgeMs: 0 })).toMatchObject({ state: 'reconnecting' })
  })
})
