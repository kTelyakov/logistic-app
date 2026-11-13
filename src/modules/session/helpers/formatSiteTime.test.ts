import { describe, expect, it } from 'vitest'
import { formatSiteDateTime, formatSiteTime } from './formatSiteTime'

const MOMENT = '2026-10-01T04:12:09Z'

describe('formatSiteTime', () => {
  it('показывает время в поясе площадки: Красноярск UTC+7', () => {
    expect(formatSiteTime(MOMENT, 'Asia/Krasnoyarsk')).toBe('11:12:09')
  })

  it('принимает и строку ISO, и миллисекунды', () => {
    expect(formatSiteTime(Date.parse(MOMENT), 'Asia/Krasnoyarsk')).toBe('11:12:09')
  })

  it('другие пояса: UTC, Индия с получасовым смещением, Бразилия', () => {
    expect(formatSiteTime(MOMENT, 'UTC')).toBe('04:12:09')
    expect(formatSiteTime(MOMENT, 'Asia/Kolkata')).toBe('09:42:09')
    expect(formatSiteTime(MOMENT, 'America/Sao_Paulo')).toBe('01:12:09')
  })

  it('полночь показывается как 00, а не 24', () => {
    expect(formatSiteTime('2026-10-01T17:00:05Z', 'Asia/Krasnoyarsk')).toBe('00:00:05')
  })

  it('дата со сменой суток в поясе площадки', () => {
    expect(formatSiteDateTime('2026-10-01T20:30:00Z', 'Asia/Krasnoyarsk')).toBe('02.10, 03:30:00')
    expect(formatSiteDateTime('2026-10-01T20:30:00Z', 'UTC')).toBe('01.10, 20:30:00')
  })

  it('результат не зависит от пояса браузера (процесса)', () => {
    const original = process.env.TZ
    const results = new Set<string>()
    for (const browserTz of ['UTC', 'America/Sao_Paulo', 'Pacific/Auckland', 'Asia/Kolkata', 'Europe/Moscow']) {
      process.env.TZ = browserTz
      results.add(formatSiteTime(MOMENT, 'Asia/Krasnoyarsk'))
      results.add(formatSiteDateTime(MOMENT, 'Asia/Krasnoyarsk'))
    }
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
    expect([...results].sort()).toEqual(['01.10, 11:12:09', '11:12:09'])
  })

  it('некорректный пояс от сервера: показывается UTC с пометкой, а не пояс браузера', () => {
    expect(formatSiteTime(MOMENT, 'Не/Пояс')).toBe('04:12:09 UTC')
  })

  it('некорректное время даёт прочерк', () => {
    expect(formatSiteTime('вчера', 'UTC')).toBe('—')
    expect(formatSiteTime(Number.NaN, 'UTC')).toBe('—')
  })
})
