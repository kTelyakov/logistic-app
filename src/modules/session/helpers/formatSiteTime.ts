/**
 * Время на экране показывается в часовом поясе площадки из /api/me, а не браузера:
 * диспетчер и площадка могут быть в разных поясах. Часовой пояс браузера не используется нигде.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string, withDate: boolean): { format: Intl.DateTimeFormat; zone: string } {
  const key = `${tz}|${withDate}`
  const cached = formatters.get(key)
  if (cached) return { format: cached, zone: tz }
  let zone = tz
  let format: Intl.DateTimeFormat
  const options: Intl.DateTimeFormatOptions = withDate
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }
  try {
    format = new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: tz })
  } catch {
    // Некорректный пояс от сервера: лучше показать UTC явно, чем упасть или молча взять пояс браузера
    zone = 'UTC'
    format = new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' })
  }
  formatters.set(key, format)
  return { format, zone }
}

function toMs(value: number | string): number {
  return typeof value === 'number' ? value : Date.parse(value)
}

function render(value: number | string, tz: string, withDate: boolean): string {
  const ms = toMs(value)
  if (Number.isNaN(ms)) return '—'
  const { format, zone } = formatterFor(tz, withDate)
  const text = format.format(new Date(ms))
  return zone === tz ? text : `${text} UTC`
}

/** ЧЧ:ММ:СС в поясе площадки. */
export function formatSiteTime(value: number | string, tz: string): string {
  return render(value, tz, false)
}

/** ДД.ММ ЧЧ:ММ:СС в поясе площадки. */
export function formatSiteDateTime(value: number | string, tz: string): string {
  return render(value, tz, true)
}
