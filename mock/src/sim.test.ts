import { describe, expect, it } from 'vitest'
import { parseConfig, type MockConfig } from './config'
import { Simulation } from './sim'
import { World } from './world'

const START = Date.parse('2026-10-01T04:00:00Z')

function setup(overrides: Partial<MockConfig> = {}) {
  const config = parseConfig({}, {
    load: 30,
    decisionMinMs: 1_000,
    decisionMaxMs: 2_000,
    executeAfterMs: 8_000,
    ...overrides,
  })
  let now = START
  const clock = () => now
  const world = new World(clock, 100_000)
  const sim = new Simulation(world, config, clock)
  return {
    world,
    sim,
    config,
    clock,
    advance(ms: number) {
      const end = now + ms
      while (now < end) {
        now += config.tickMs
        sim.tick(now)
      }
    },
  }
}

describe('Simulation', () => {
  it('создаёт машины и 6 пунктов', () => {
    const { world } = setup({ load: 150 })
    expect(world.vehicles.size).toBe(150)
    expect(world.points.size).toBe(6)
  })

  it('каждая машина обновляется не реже раза в секунду', () => {
    const { world, advance } = setup()
    const seen = new Map<string, number>()
    world.subscribe((e) => {
      const m = JSON.parse(e.json)
      if (m.type === 'vehicle') seen.set(m.data.vehicle_id, (seen.get(m.data.vehicle_id) ?? 0) + 1)
    })
    advance(3_000)
    expect(seen.size).toBe(30)
    for (const count of seen.values()) expect(count).toBeGreaterThanOrEqual(3)
  })

  it('last_seen машины обновляется вместе с событием', () => {
    const { world, advance, clock } = setup()
    advance(2_000)
    for (const v of world.vehicles.values()) {
      expect(Date.parse(v.last_seen)).toBeGreaterThan(clock() - 1_500)
    }
  })

  it('очередь считает сервер: service_start не раньше eta, ожидание согласовано', () => {
    const { world, advance, sim, clock } = setup({ load: 150 })
    advance(20_000)
    sim.flushQueues(clock())
    let checked = 0
    for (const point of world.points.values()) {
      let previousEta = 0
      for (const item of point.queue) {
        const eta = Date.parse(item.eta)
        const start = Date.parse(item.service_start)
        expect(start).toBeGreaterThanOrEqual(eta)
        expect(item.wait_s).toBe(Math.round((start - eta) / 1000))
        expect(eta).toBeGreaterThanOrEqual(previousEta)
        previousEta = eta
        checked += 1
      }
      expect(point.queue.length).toBeLessThanOrEqual(20)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('версия пункта растёт при изменении очереди', () => {
    const { world, advance } = setup({ load: 150 })
    const initial = [...world.points.values()].map((p) => p.version)
    advance(20_000)
    const later = [...world.points.values()].map((p) => p.version)
    expect(later.some((v, i) => v > (initial[i] ?? 0))).toBe(true)
  })

  it('решение: pending, затем executed или expired ровно в execute_at', () => {
    const { world, advance, clock } = setup({ load: 150 })
    advance(5_000)
    const pending = [...world.decisions.values()].find((d) => d.status === 'pending')
    expect(pending).toBeDefined()
    if (!pending) return
    expect(Date.parse(pending.execute_at) - Date.parse(pending.created_at)).toBe(8_000)
    expect(pending.version).toBe(1)

    while (clock() < Date.parse(pending.execute_at) - 200) advance(100)
    expect(pending.status).toBe('pending')
    advance(600)
    expect(['executed', 'expired']).toContain(pending.status)
    expect(pending.version).toBe(2)
  })

  it('исполненное решение переправляет машину к to_point', () => {
    const { world, advance } = setup({ load: 150, executeAfterMs: 1_000 })
    let checked = 0
    const redirected = new Set<string>()
    for (let i = 0; i < 400 && checked < 3; i++) {
      advance(100)
      for (const d of world.decisions.values()) {
        if (d.status === 'executed' && !redirected.has(d.decision_id)) {
          redirected.add(d.decision_id)
          // Проверяем сразу после исполнения: дальше машина может поехать куда угодно
          expect(world.vehicles.get(d.vehicle_id)?.point_id).toBe(d.to_point)
          expect(world.vehicles.get(d.vehicle_id)?.state).toBe('moving_empty')
          checked += 1
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('отмена до исполнения: cancelled, версия растёт, машина не перенаправляется', () => {
    const { world, advance, sim } = setup({ load: 150 })
    advance(5_000)
    const pending = [...world.decisions.values()].find((d) => d.status === 'pending')
    expect(pending).toBeDefined()
    if (!pending) return
    const before = world.vehicles.get(pending.vehicle_id)?.point_id
    sim.cancelDecision(pending)
    expect(pending.status).toBe('cancelled')
    expect(pending.version).toBe(2)
    advance(10_000)
    expect(pending.status).toBe('cancelled')
    expect(pending.version).toBe(2)
    expect(world.vehicles.get(pending.vehicle_id)?.point_id).toBe(before)
  })

  it('пункт в ручном режиме не участвует в новых решениях', () => {
    const { world, advance, sim } = setup({ load: 150, executeAfterMs: 500 })
    for (const id of ['p-3', 'p-4', 'p-5', 'p-6']) sim.setPointMode(id, 'manual')
    advance(60_000)
    expect(world.decisions.size).toBeGreaterThan(0)
    for (const d of world.decisions.values()) {
      expect(['p-1', 'p-2']).toContain(d.from_point)
      expect(['p-1', 'p-2']).toContain(d.to_point)
    }
  })

  it('смена режима увеличивает версию один раз и порождает событие', () => {
    const { world, sim } = setup()
    const point = world.points.get('p-2')
    const v0 = point?.version ?? 0
    const events: string[] = []
    world.subscribe((e) => events.push(JSON.parse(e.json).type))
    sim.setPointMode('p-2', 'manual')
    sim.setPointMode('p-2', 'manual')
    expect(point?.version).toBe(v0 + 1)
    expect(events).toEqual(['point'])
  })

  it('reason может содержать произвольные символы', () => {
    const { world, advance } = setup({ load: 150, decisionMinMs: 500, decisionMaxMs: 600, executeAfterMs: 500 })
    advance(60_000)
    const reasons = [...world.decisions.values()].map((d) => d.reason)
    expect(reasons.length).toBeGreaterThan(8)
    expect(reasons.some((r) => r.includes('<'))).toBe(true)
  })

  it('FAULTS=stale: часть машин не обновляется, остальные обновляются', () => {
    const { world, advance } = setup({
      load: 50,
      faults: new Set(['stale']),
      staleSilentMs: 100_000,
      staleActiveMs: 1,
    })
    const updated = new Set<string>()
    world.subscribe((e) => {
      const m = JSON.parse(e.json)
      if (m.type === 'vehicle') updated.add(m.data.vehicle_id)
    })
    advance(3_000)
    expect(updated.has('v-01')).toBe(false) // индекс 0 из «молчащей» группы
    expect(updated.has('v-02')).toBe(true)
    expect(updated.size).toBeLessThan(50)
    expect(updated.size).toBeGreaterThanOrEqual(35)
  })
})

describe('PREFILL_DECISIONS', () => {
  it('история за последний час: завершённые решения, равномерно по часу, в снимке, не в журнале', () => {
    const { world, config, clock } = setup({ load: 150, prefillDecisions: 360, decisionMinMs: 1_000_000, decisionMaxMs: 2_000_000 })
    const decisions = [...world.decisions.values()]
    expect(config.prefillDecisions).toBe(360)
    expect(decisions).toHaveLength(360)
    expect(decisions.every((d) => d.status !== 'pending')).toBe(true)
    expect(new Set(decisions.map((d) => d.decision_id)).size).toBe(360)
    const times = decisions.map((d) => Date.parse(d.created_at)).sort((a, b) => a - b)
    expect(times[0]).toBeGreaterThan(clock() - 3_600_000)
    expect(times[times.length - 1]).toBeLessThan(clock())
    expect(world.recentDecisions()).toHaveLength(360)
    expect(world.seq).toBe(0) // в журнал не пишется: события создаются только живой симуляцией
    for (const d of decisions) expect(d.from_point).not.toBe(d.to_point)
  })

  it('по ходу времени старейшие выходят из часового окна, окно не растёт', () => {
    const { world, advance } = setup({ load: 20, prefillDecisions: 360, decisionMinMs: 1_000_000, decisionMaxMs: 2_000_000 })
    expect(world.recentDecisions()).toHaveLength(360)
    advance(600_000) // 10 минут без новых решений: шестая часть часа, то есть около 60 из 360, вышла из окна
    const left = world.recentDecisions().length
    expect(left).toBeGreaterThanOrEqual(298)
    expect(left).toBeLessThanOrEqual(302)
  })

  it('без настройки истории нет', () => {
    expect(setup().world.decisions.size).toBe(0)
  })
})
