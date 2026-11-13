// Движок против настоящей заглушки (mock/) в Node: fetch и WebSocket настоящие, браузера нет.
// Заглушка с отказами, затем пауза, затем состояние зеркала совпадает с истинным состоянием сервера.
import { afterEach, describe, expect, it } from 'vitest'
import type { MockEnv } from './convergenceSupport'
import { runScenario, type Scenario } from './convergenceSupport'

const scenarios: Array<[string, Scenario]> = [
  ['без отказов', { mock: {}, runMs: 2_500 }],
  ['drop,dup,reorder', { mock: { faults: ['drop', 'dup', 'reorder'], faultRate: 0.05, seed: 3 }, runMs: 6_000, expectResyncs: true }],
  ['только drop', { mock: { faults: ['drop'], faultRate: 0.08, seed: 5 }, runMs: 4_000, expectResyncs: true }],
  ['только dup и reorder: без лишних снимков', { mock: { faults: ['dup', 'reorder'], faultRate: 0.1, seed: 7 }, runMs: 4_000, expectNoResyncs: true }],
  ['reset и обрывы соединения', { mock: { faults: ['reset'], resetIntervalMs: 700, seed: 1 }, runMs: 5_000, expectReconnects: true }],
  ['всё вместе на 1500 машинах', { mock: { faults: ['drop', 'dup', 'reorder', 'reset'], faultRate: 0.01, resetIntervalMs: 1_500, load: 1_500, seed: 9 }, runMs: 5_000 }],
]

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

describe('экран-зеркало сходится с состоянием сервера', () => {
  for (const [name, scenario] of scenarios) {
    it(name, async () => {
      const result = await runScenario(scenario, (fn) => cleanups.push(fn))
      expect(result.differences, result.differences.join('\n')).toEqual([])
      expect(result.mirrorSeq).toBe(result.serverSeq)
      expect(result.vehicles).toBeGreaterThan(0)
      if (scenario.expectResyncs) expect(result.resyncs, 'отказы должны были вызвать новые снимки').toBeGreaterThan(0)
      if (scenario.expectNoResyncs) expect(result.resyncs, 'перестановки и повторы не требуют снимка').toBe(0)
      if (scenario.expectReconnects) expect(result.sockets, 'должны быть переподключения').toBeGreaterThan(2)
      if (process.env.SYNC_REPORT) process.stderr.write(`${name}: seq ${result.serverSeq}, снимков ${result.snapshots}, повторных ${result.resyncs}, соединений ${result.sockets}, пакетов/с ${result.batchesPerSecond.toFixed(1)}\n`)
      // пакеты идут не чаще раза в flushMs
      expect(result.batchesPerSecond).toBeLessThan(25)
    }, 40_000)
  }
})

export type { MockEnv }
