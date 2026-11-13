import type { Decision, DecisionMessage } from '@dispatch/contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDecisionsStore } from './decisionsStore'

const BASE = Date.parse('2026-10-01T04:00:00Z')
const iso = (offsetMs: number) => new Date(BASE + offsetMs).toISOString()

const decision = (n: number, patch: Partial<Decision> = {}): Decision => ({
  decision_id: `d-${n}`, vehicle_id: 'v-1', from_point: 'p-1', to_point: 'p-2', gain_s: 10, reason: 'r',
  status: 'pending', created_at: iso(n * 1000), execute_at: iso(n * 1000 + 60_000), version: 1, ...patch,
})
const message = (seq: number, d: Decision): DecisionMessage => ({ seq, at: iso(0), type: 'decision', data: d })

describe('decisionsStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('новые сверху', () => {
    const store = useDecisionsStore()
    store.replaceDecisionsMutator([decision(1), decision(3), decision(2)])
    expect(store.newestFirst.map((d) => d.decision_id)).toEqual(['d-3', 'd-2', 'd-1'])
  })

  it('при равном времени порядок по номеру решения, числовой: d-10 новее d-9', () => {
    const store = useDecisionsStore()
    const same = iso(0)
    store.replaceDecisionsMutator([decision(9, { created_at: same }), decision(10, { created_at: same })])
    expect(store.newestFirst.map((d) => d.decision_id)).toEqual(['d-10', 'd-9'])
  })

  it('сообщение обновляет статус и версию, а не дублирует решение', () => {
    const store = useDecisionsStore()
    store.replaceDecisionsMutator([decision(1)])
    store.applyDecisionMessagesMutator([message(2, decision(1, { status: 'cancelled', version: 2 }))])
    expect(store.size).toBe(1)
    expect(store.get('d-1')).toMatchObject({ status: 'cancelled', version: 2 })
  })

  it('устаревшая версия не затирает более новую (опоздавшее сообщение)', () => {
    const store = useDecisionsStore()
    store.replaceDecisionsMutator([decision(1, { status: 'executed', version: 3 })])
    store.applyDecisionMessagesMutator([message(2, decision(1, { status: 'pending', version: 1 }))])
    expect(store.get('d-1')).toMatchObject({ status: 'executed', version: 3 })
  })

  it('ответ сервера на команду (409) обновляет решение актуальным состоянием', () => {
    const store = useDecisionsStore()
    store.replaceDecisionsMutator([decision(1)])
    store.applyServerDecisionMutator(decision(1, { status: 'executed', version: 2 }))
    expect(store.get('d-1')?.status).toBe('executed')
    store.applyServerDecisionMutator(decision(1, { status: 'pending', version: 1 }))
    expect(store.get('d-1')?.status).toBe('executed')
  })

  it('окно в один час по времени сервера: старые решения удаляются, граница включена', () => {
    const store = useDecisionsStore()
    const now = BASE + 2 * 3_600_000
    store.replaceDecisionsMutator([
      decision(1, { created_at: new Date(now - 3_600_001).toISOString() }), // старше часа
      decision(2, { created_at: new Date(now - 3_600_000).toISOString() }), // ровно час: остаётся
      decision(3, { created_at: new Date(now - 10).toISOString() }),
    ])
    store.pruneMutator(now)
    expect(store.newestFirst.map((d) => d.decision_id)).toEqual(['d-3', 'd-2'])
  })

  it('долгая работа: число решений ограничено окном, а не временем работы', () => {
    const store = useDecisionsStore()
    // 12 часов, решение раз в 10 секунд, чистка раз в минуту
    for (let t = 0; t <= 12 * 3_600_000; t += 10_000) {
      store.applyDecisionMessagesMutator([message(t, decision(t / 10_000, { created_at: new Date(BASE + t).toISOString() }))])
      if (t % 60_000 === 0) store.pruneMutator(BASE + t)
    }
    expect(store.size).toBeLessThanOrEqual(3_600_000 / 10_000 + 7)
    expect(store.size).toBeGreaterThan(300)
  })
})
