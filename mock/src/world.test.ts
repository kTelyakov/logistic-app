import { describe, expect, it } from 'vitest'
import type { Vehicle } from '@dispatch/contract'
import { World } from './world'

const vehicle = (id: string): Vehicle => ({
  vehicle_id: id,
  name: id,
  x_m: 0,
  y_m: 0,
  heading_deg: 0,
  speed_kmh: 0,
  state: 'idle',
  point_id: 'p-1',
  last_seen: '2026-10-01T04:00:00Z',
})

function filled(count: number, journalSize = 1000): World {
  const world = new World(() => Date.parse('2026-10-01T04:00:00Z'), journalSize)
  for (let i = 0; i < count; i++) world.emit('vehicle', vehicle(`v-${i}`))
  return world
}

describe('World', () => {
  it('seq растёт ровно на 1 и совпадает с seq в сообщении', () => {
    const world = filled(5)
    const entries = world.since(0)
    expect(entries?.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
    expect(entries?.map((e) => JSON.parse(e.json).seq)).toEqual([1, 2, 3, 4, 5])
    expect(world.seq).toBe(5)
  })

  it('since возвращает только сообщения после указанного seq', () => {
    const world = filled(10)
    expect(world.since(7)?.map((e) => e.seq)).toEqual([8, 9, 10])
    expect(world.since(10)).toEqual([])
  })

  it('запись в журнале фиксирует состояние на момент события', () => {
    const world = new World(() => 0, 100)
    const v = vehicle('v-1')
    world.emit('vehicle', v)
    v.x_m = 999
    const [entry] = world.since(0) ?? []
    expect(JSON.parse(entry?.json ?? '{}').data.x_m).toBe(0)
  })

  it('возвращает null, если клиент опережает сервер', () => {
    expect(filled(3).since(50)).toBeNull()
  })

  it('возвращает null, если сообщения уже вытеснены из журнала', () => {
    const world = filled(500, 20)
    const oldest = world.since(world.seq - 1) // последнее всегда доступно
    expect(oldest).toHaveLength(1)
    expect(world.since(0)).toBeNull()
    expect(world.since(world.seq - 20)).not.toBeNull()
  })

  it('на пустом журнале since=0 даёт пустой список', () => {
    expect(filled(0).since(0)).toEqual([])
  })

  it('подписчик получает каждую запись и может отписаться', () => {
    const world = filled(0)
    const seen: number[] = []
    const off = world.subscribe((e) => seen.push(e.seq))
    world.emit('vehicle', vehicle('a'))
    off()
    world.emit('vehicle', vehicle('b'))
    expect(seen).toEqual([1])
  })

  it('в снимок попадают решения только за последний час', () => {
    const now = Date.parse('2026-10-01T05:00:00Z')
    const world = new World(() => now, 100)
    const base = {
      vehicle_id: 'v-1',
      from_point: 'p-1',
      to_point: 'p-2',
      gain_s: 1,
      reason: '',
      status: 'executed' as const,
      execute_at: '2026-10-01T04:00:00Z',
      version: 1,
    }
    world.decisions.set('old', { ...base, decision_id: 'old', created_at: '2026-10-01T03:30:00Z' })
    world.decisions.set('new', { ...base, decision_id: 'new', created_at: '2026-10-01T04:30:00Z' })
    expect(world.snapshot().decisions.map((d) => d.decision_id)).toEqual(['new'])
  })
})
