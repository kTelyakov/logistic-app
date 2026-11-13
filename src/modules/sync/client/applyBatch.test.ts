import type { Vehicle } from '@dispatch/contract'
import { describe, expect, it } from 'vitest'
import { VehicleArena } from '@/modules/vehicles'
import type { BatchOutput } from '../protocol'
import { Mirror } from '../testing/mirror'
import { BatchApplier } from './applyBatch'

const v = (n: number): Vehicle => ({ vehicle_id: `v-${n}`, name: `Т-${n}`, x_m: n, y_m: n, heading_deg: 0, speed_kmh: 0, state: 'idle', point_id: 'p-1', last_seen: '2026-10-01T04:00:00.000Z' })

function frameOf(arena: VehicleArena) {
  return { frame: arena.createFrame(), tables: { ids: [...arena.ids], names: [...arena.names], points: [...arena.points] } }
}

describe('BatchApplier', () => {
  it('применяет кадр, справочники и seq; возвращает буферы только прежнего кадра', () => {
    const mirror = new Mirror()
    const applier = new BatchApplier(mirror)
    const arena = new VehicleArena()
    arena.upsertMany([v(1), v(2)])
    const first = frameOf(arena)
    expect(applier.apply({ type: 'batch', seq: 5, vehicles: first })).toBeUndefined() // прежнего кадра нет
    expect(mirror.seq).toBe(5)
    expect(mirror.vehicles().map((x) => x.vehicle_id)).toEqual(['v-1', 'v-2'])

    arena.upsert({ ...v(1), x_m: 99 })
    const second = arena.createFrame() // справочники не менялись: tables не передаются
    const released = applier.apply({ type: 'batch', seq: 6, vehicles: { frame: second } })
    expect(released).toBe(first.frame.columns)
    expect(mirror.vehicles().find((x) => x.vehicle_id === 'v-1')?.x_m).toBe(99)
    expect(mirror.vehicles().map((x) => x.name)).toEqual(['Т-1', 'Т-2']) // прежние справочники сохранены
  })

  it('пакет без кадра не трогает машины и ничего не возвращает', () => {
    const mirror = new Mirror()
    const applier = new BatchApplier(mirror)
    const arena = new VehicleArena()
    arena.upsert(v(1))
    applier.apply({ type: 'batch', seq: 1, vehicles: frameOf(arena) })
    const batch: BatchOutput = { type: 'batch', seq: 2, entities: { messages: [] } }
    expect(applier.apply(batch)).toBeUndefined()
    expect(mirror.vehicles()).toHaveLength(1)
    expect(mirror.seq).toBe(2)
  })

  it('замена сущностей и затем изменения применяются по порядку', () => {
    const mirror = new Mirror()
    const applier = new BatchApplier(mirror)
    const point = { point_id: 'p-1', name: 'П1', x_m: 0, y_m: 0, mode: 'auto' as const, version: 1, queue: [] }
    applier.apply({
      type: 'batch',
      seq: 3,
      entities: {
        replace: { points: [point], decisions: [] },
        messages: [{ seq: 3, at: '2026-10-01T04:00:00Z', type: 'point', data: { ...point, mode: 'manual', version: 2 } }],
      },
    })
    expect(mirror.points.get('p-1')).toMatchObject({ mode: 'manual', version: 2 })
  })
})
