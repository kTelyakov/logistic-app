import type { Point, PointMessage } from '@dispatch/contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePointsStore } from './pointsStore'

const point = (n: number, patch: Partial<Point> = {}): Point => ({ point_id: `p-${n}`, name: `Пункт ${n}`, x_m: 0, y_m: 0, mode: 'auto', version: 1, queue: [], ...patch })
const message = (seq: number, p: Point): PointMessage => ({ seq, at: '2026-10-01T04:00:00Z', type: 'point', data: p })

describe('pointsStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('замена и естественный порядок: p-2 раньше p-10', () => {
    const store = usePointsStore()
    store.replacePointsMutator([point(10), point(2), point(1)])
    expect(store.sorted.map((p) => p.point_id)).toEqual(['p-1', 'p-2', 'p-10'])
  })

  it('сообщение заменяет пункт целиком: очередь берётся как есть с сервера', () => {
    const store = usePointsStore()
    store.replacePointsMutator([point(1, { queue: [{ vehicle_id: 'v-1', eta: 'a', service_start: 'b', wait_s: 5 }] })])
    store.applyPointMessagesMutator([message(5, point(1, { version: 2, mode: 'manual', queue: [] }))])
    expect(store.get('p-1')).toMatchObject({ version: 2, mode: 'manual', queue: [] })
    expect(store.sorted).toHaveLength(1)
  })

  it('новый пункт добавляется; замена снимком убирает прежние', () => {
    const store = usePointsStore()
    store.replacePointsMutator([point(1)])
    store.applyPointMessagesMutator([message(2, point(2))])
    expect(store.sorted).toHaveLength(2)
    store.replacePointsMutator([point(3)])
    expect(store.sorted.map((p) => p.point_id)).toEqual(['p-3'])
  })

  it('отсортированный список обновляется реактивно при сообщении', () => {
    const store = usePointsStore()
    store.replacePointsMutator([point(1)])
    const before = store.sorted
    store.applyPointMessagesMutator([message(2, point(1, { version: 9 }))])
    expect(store.sorted).not.toBe(before)
    expect(store.sorted[0]?.version).toBe(9)
  })
})
