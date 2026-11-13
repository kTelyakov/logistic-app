import type { Decision } from '@dispatch/contract'

/** Сервер отдаёт решения за последний час; экран хранит то же окно по времени сервера. */
export const DECISION_WINDOW_MS = 60 * 60 * 1000

export function isWithinWindow(decision: Decision, serverNowMs: number): boolean {
  return Date.parse(decision.created_at) >= serverNowMs - DECISION_WINDOW_MS
}

/** Новые сверху: по времени создания, при равенстве по номеру решения. */
export function sortNewestFirst(decisions: readonly Decision[]): Decision[] {
  return [...decisions].sort((a, b) => {
    const byTime = Date.parse(b.created_at) - Date.parse(a.created_at)
    return byTime !== 0 ? byTime : b.decision_id.localeCompare(a.decision_id, 'ru', { numeric: true })
  })
}
