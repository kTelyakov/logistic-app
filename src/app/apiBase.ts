/**
 * Адрес сервера: `?api=<url>` (стенды и e2e, где у каждого теста своя заглушка) или тот же origin.
 * В разработке Vite проксирует /api, /ws и /debug на заглушку, поэтому по умолчанию адрес пустой.
 */
export function resolveApiBase(search: string): string {
  const value = new URLSearchParams(search).get('api')
  return value ? value.replace(/\/+$/, '') : ''
}
