import type { Vehicle, VehicleState } from '@dispatch/contract'
import { describe, expect, it } from 'vitest'
import { FramePool } from './FramePool'
import { codeToState, stateToCode, VEHICLE_STATES } from './states'
import { VehicleArena } from './VehicleArena'
import { EMPTY_VIEW, findInRect, findNearest, vehicleAt, type VehicleView } from './VehicleView'

const vehicle = (n: number, patch: Partial<Vehicle> = {}): Vehicle => ({
  vehicle_id: `v-${n}`,
  name: `Т-${n}`,
  x_m: (n * 7.3) % 6000,
  y_m: (n * 3.1) % 4000,
  heading_deg: n % 360,
  speed_kmh: (n % 60) + 0.5,
  state: VEHICLE_STATES[n % VEHICLE_STATES.length] as VehicleState,
  point_id: `p-${(n % 6) + 1}`,
  last_seen: new Date(Date.parse('2026-10-01T04:00:00.123Z') + n * 1000).toISOString(),
  ...patch,
})

function viewOf(arena: VehicleArena): VehicleView {
  const frame = arena.createFrame()
  return {
    count: frame.count,
    columns: frame.columns,
    tables: { ids: arena.ids, names: arena.names, points: arena.points },
  }
}

describe('состояния', () => {
  it('все шесть состояний кодируются туда и обратно', () => {
    expect(VEHICLE_STATES).toHaveLength(6)
    for (const state of VEHICLE_STATES) expect(codeToState(stateToCode(state))).toBe(state)
    expect(new Set(VEHICLE_STATES.map(stateToCode)).size).toBe(6)
  })

  it('неизвестное состояние и код выбрасывают ошибку', () => {
    expect(() => stateToCode('flying' as VehicleState)).toThrow()
    expect(() => codeToState(99)).toThrow()
  })
})

describe('VehicleArena', () => {
  it('повторная запись не меняет слот и не увеличивает число машин', () => {
    const arena = new VehicleArena()
    const a = arena.upsert(vehicle(1))
    const b = arena.upsert(vehicle(2))
    expect(arena.upsert(vehicle(1, { x_m: 100 }))).toBe(a)
    expect(arena.count).toBe(2)
    expect(b).toBe(1)
    expect(arena.toVehicle(a)?.x_m).toBe(100)
  })

  it('круговая проверка: значения возвращаются без искажений', () => {
    const arena = new VehicleArena()
    const original = vehicle(17, { x_m: 2410.5, y_m: 1180.0, heading_deg: 72, speed_kmh: 24.5, state: 'moving_empty', point_id: 'p-2' })
    const slot = arena.upsert(original)
    expect(arena.toVehicle(slot)).toEqual(original)
  })

  it('координаты с одним знаком после запятой читаются точно на всей площадке', () => {
    const arena = new VehicleArena()
    for (let i = 0; i < 2000; i++) {
      const x = Math.round(((i * 2.9137) % 6000) * 10) / 10
      const y = Math.round(((i * 1.7711) % 4000) * 10) / 10
      const slot = arena.upsert(vehicle(i, { x_m: x, y_m: y }))
      const read = arena.toVehicle(slot)
      expect(read?.x_m).toBe(x)
      expect(read?.y_m).toBe(y)
    }
  })

  it('last_seen сохраняется с точностью до миллисекунды', () => {
    const arena = new VehicleArena()
    const slot = arena.upsert(vehicle(1, { last_seen: '2026-10-01T04:12:09.987Z' }))
    expect(arena.toVehicle(slot)?.last_seen).toBe('2026-10-01T04:12:09.987Z')
  })

  it('рост ёмкости не теряет данные: 20 000 машин', () => {
    const arena = new VehicleArena(8)
    for (let i = 0; i < 20_000; i++) arena.upsert(vehicle(i))
    expect(arena.count).toBe(20_000)
    expect(arena.capacity).toBeGreaterThanOrEqual(20_000)
    for (const i of [0, 1, 7, 8, 9, 1023, 1024, 19_999]) {
      const read = arena.toVehicle(arena.slotOf(`v-${i}`) as number)
      expect(read?.vehicle_id).toBe(`v-${i}`)
      expect(read?.state).toBe(vehicle(i).state)
      expect(read?.last_seen).toBe(vehicle(i).last_seen)
    }
  })

  it('смена пункта машины отражается в данных, а справочник пунктов не растёт', () => {
    const arena = new VehicleArena()
    const slot = arena.upsert(vehicle(1, { point_id: 'p-1' }))
    const revision = arena.tablesRevision
    arena.upsert(vehicle(1, { point_id: 'p-1' }))
    expect(arena.tablesRevision).toBe(revision)
    arena.upsert(vehicle(1, { point_id: 'p-3' }))
    expect(arena.toVehicle(slot)?.point_id).toBe('p-3')
    expect(arena.points).toEqual(['p-1', 'p-3'])
    arena.upsert(vehicle(1, { point_id: 'p-1' }))
    expect(arena.points).toEqual(['p-1', 'p-3'])
  })

  it('ревизия таблиц меняется только при новой машине, новом пункте и очистке', () => {
    const arena = new VehicleArena()
    arena.upsert(vehicle(1))
    const r1 = arena.tablesRevision
    arena.upsert(vehicle(1, { x_m: 5 }))
    expect(arena.tablesRevision).toBe(r1)
    arena.upsert(vehicle(2))
    expect(arena.tablesRevision).toBeGreaterThan(r1)
    const r2 = arena.tablesRevision
    arena.clear()
    expect(arena.tablesRevision).toBeGreaterThan(r2)
  })

  it('очистка освобождает слоты: после неё только новые машины', () => {
    const arena = new VehicleArena()
    for (let i = 0; i < 50; i++) arena.upsert(vehicle(i))
    arena.clear()
    expect(arena.count).toBe(0)
    expect(arena.slotOf('v-1')).toBeUndefined()
    expect(arena.upsert(vehicle(900))).toBe(0)
    expect(arena.count).toBe(1)
    expect(arena.toVehicle(0)?.vehicle_id).toBe('v-900')
    expect(arena.toVehicle(1)).toBeUndefined()
  })

  it('чтение несуществующего слота', () => {
    const arena = new VehicleArena()
    expect(arena.toVehicle(0)).toBeUndefined()
    expect(arena.toVehicle(-1)).toBeUndefined()
  })
})

describe('кадры', () => {
  it('кадр не зависит от дальнейших записей в арену', () => {
    const arena = new VehicleArena()
    arena.upsert(vehicle(1, { x_m: 10 }))
    const frame = arena.createFrame()
    arena.upsert(vehicle(1, { x_m: 999 }))
    arena.upsert(vehicle(2))
    expect(frame.count).toBe(1)
    expect(frame.columns.x[0]).toBe(10)
  })

  it('кадр пишется в буферы из пула, и они переиспользуются', () => {
    const arena = new VehicleArena()
    for (let i = 0; i < 100; i++) arena.upsert(vehicle(i))
    const pool = new FramePool()
    const first = arena.createFrame(pool.take(arena.count))
    pool.give(first.columns)
    const taken = pool.take(arena.count)
    expect(taken).toBe(first.columns)
    const second = arena.createFrame(taken)
    expect(second.columns).toBe(first.columns)
    expect(pool.take(arena.count)).toBeUndefined()
  })

  it('пул не отдаёт буферы меньшей ёмкости, чем нужно', () => {
    const arena = new VehicleArena()
    for (let i = 0; i < 3000; i++) arena.upsert(vehicle(i))
    const pool = new FramePool()
    pool.give(FramePool.allocate(1024))
    expect(pool.take(3000)).toBeUndefined()
    expect(arena.createFrame(pool.take(3000)).count).toBe(3000)
  })

  it('представление читает так же, как арена', () => {
    const arena = new VehicleArena()
    for (let i = 0; i < 300; i++) arena.upsert(vehicle(i))
    const view = viewOf(arena)
    for (const i of [0, 1, 150, 299]) expect(vehicleAt(view, i)).toEqual(arena.toVehicle(i))
    expect(vehicleAt(view, 300)).toBeUndefined()
    expect(vehicleAt(EMPTY_VIEW, 0)).toBeUndefined()
  })
})

describe('запросы', () => {
  const grid = (): VehicleView => {
    const arena = new VehicleArena()
    arena.upsert(vehicle(1, { x_m: 100, y_m: 100 }))
    arena.upsert(vehicle(2, { x_m: 200, y_m: 100 }))
    arena.upsert(vehicle(3, { x_m: 100, y_m: 300 }))
    arena.upsert(vehicle(4, { x_m: 5000, y_m: 3000 }))
    return viewOf(arena)
  }

  it('findInRect: границы включены', () => {
    const view = grid()
    expect(findInRect(view, 100, 100, 200, 100)).toEqual([0, 1])
    expect(findInRect(view, 101, 100, 199, 100)).toEqual([])
    expect(findInRect(view, 0, 0, 6000, 4000)).toEqual([0, 1, 2, 3])
  })

  it('findNearest: ближайшая в радиусе или -1', () => {
    const view = grid()
    expect(findNearest(view, 110, 105, 50)).toBe(0)
    expect(findNearest(view, 190, 100, 50)).toBe(1)
    expect(findNearest(view, 3000, 2000, 100)).toBe(-1)
    expect(findNearest(view, 5100, 3050, 200)).toBe(3)
    expect(findNearest(EMPTY_VIEW, 0, 0, 1e9)).toBe(-1)
  })

  it('findNearest: при равных расстояниях выбирает одну из машин, а не падает', () => {
    const arena = new VehicleArena()
    arena.upsert(vehicle(1, { x_m: 0, y_m: 0 }))
    arena.upsert(vehicle(2, { x_m: 100, y_m: 0 }))
    expect([0, 1]).toContain(findNearest(viewOf(arena), 50, 0, 60))
  })
})

describe('15 000 машин', () => {
  it('запись, кадр и запросы укладываются в бюджет', () => {
    const arena = new VehicleArena()
    const vehicles = Array.from({ length: 15_000 }, (_, i) => vehicle(i))
    for (const v of vehicles) arena.upsert(v) // прогрев и рост ёмкости

    const t0 = performance.now()
    for (const v of vehicles) arena.upsert(v)
    const write = performance.now() - t0

    const pool = new FramePool()
    const t1 = performance.now()
    const frame = arena.createFrame(pool.take(arena.count))
    const copy = performance.now() - t1

    const view: VehicleView = { count: frame.count, columns: frame.columns, tables: { ids: arena.ids, names: arena.names, points: arena.points } }
    const t2 = performance.now()
    findNearest(view, 3000, 2000, 500)
    findInRect(view, 1000, 1000, 2000, 2000)
    const query = performance.now() - t2

    // Запас на медленную машину: целевые цифры на порядок меньше
    expect(write, `запись ${write.toFixed(1)} мс`).toBeLessThan(150)
    expect(copy, `кадр ${copy.toFixed(2)} мс`).toBeLessThan(15)
    expect(query, `запросы ${query.toFixed(2)} мс`).toBeLessThan(15)
  })
})
