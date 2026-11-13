import type { Decision } from '@dispatch/contract'
import { describe, expect, it } from 'vitest'
import { toDecisionView, type ViewContext } from './viewModel'

const decision: Decision = {
  decision_id: 'd-3381', vehicle_id: 'v-17', from_point: 'p-2', to_point: 'p-4', gain_s: 140,
  reason: 'Очередь на Пункт 2 — 4 машины, Пункт 4 свободен', status: 'pending',
  created_at: '2026-10-01T04:12:05Z', execute_at: '2026-10-01T04:13:05Z', version: 1,
}
const ctx = (patch: Partial<ViewContext> = {}): ViewContext => ({
  tz: 'Asia/Krasnoyarsk',
  serverNowMs: Date.parse('2026-10-01T04:12:35Z'),
  vehicleName: (id) => (id === 'v-17' ? 'Т-17' : id),
  pointName: (id) => `Пункт ${id.slice(2)}`,
  ...patch,
})

describe('toDecisionView', () => {
  it('значения сервера отформатированы: выигрыш как у сервера, время площадки, маршрут по названиям', () => {
    const view = toDecisionView(decision, ctx())
    expect(view).toMatchObject({
      id: 'd-3381', vehicleName: 'Т-17', route: 'Пункт 2 → Пункт 4', gain: '2 мин 20 с',
      createdAt: '01.10, 11:12:05', statusLabel: 'Ожидает', version: 1, pending: true,
    })
  })

  it('обратный отсчёт считается по времени сервера', () => {
    expect(toDecisionView(decision, ctx()).countdown).toBe('00:30')
    expect(toDecisionView(decision, ctx({ serverNowMs: Date.parse('2026-10-01T04:13:04.100Z') })).countdown).toBe('00:01')
  })

  it('время браузера в отсчёте не участвует: меняется только serverNowMs', () => {
    const a = toDecisionView(decision, ctx({ serverNowMs: Date.parse('2026-10-01T04:12:05Z') }))
    expect(a.countdown).toBe('01:00')
  })

  it('отсчёт не уходит в минус, пока сервер не прислал исполнение', () => {
    expect(toDecisionView(decision, ctx({ serverNowMs: Date.parse('2026-10-01T04:15:00Z') })).countdown).toBe('00:00')
  })

  it('у исполненного, отменённого и истёкшего отсчёта нет', () => {
    for (const status of ['executed', 'cancelled', 'expired'] as const) {
      const view = toDecisionView({ ...decision, status }, ctx())
      expect(view.countdown).toBeNull()
      expect(view.pending).toBe(false)
    }
  })

  it('неизвестные машина и пункт показываются по id', () => {
    const view = toDecisionView({ ...decision, vehicle_id: 'v-999', from_point: 'p-9' }, ctx({ vehicleName: (id) => id }))
    expect(view.vehicleName).toBe('v-999')
  })

  it('reason передаётся как есть', () => {
    const reason = '<img src=x onerror=alert(1)> & "кавычки"'
    expect(toDecisionView({ ...decision, reason }, ctx()).reason).toBe(reason)
  })
})
