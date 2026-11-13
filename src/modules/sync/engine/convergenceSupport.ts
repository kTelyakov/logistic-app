import type { Decision, Point, Vehicle } from '@dispatch/contract'
import type { MockConfig } from '../../../../mock/src/config'
import type { MockServer } from '../../../../mock/src/server'
import { startFast } from '../../../../mock/src/testing'
import { configureHttp } from '@/shared/http'
import { fetchSnapshot } from '../api/fetchSnapshot'
import { openSocket } from '../api/openSocket'
import { BatchApplier } from '../client/applyBatch'
import { Mirror } from '../testing/mirror'
import { SyncEngine } from './SyncEngine'

export type MockEnv = Partial<MockConfig> & { faults?: string[] }

export interface Scenario {
  mock: Omit<Partial<MockConfig>, 'faults'> & { faults?: string[] }
  runMs: number
  expectResyncs?: boolean
  expectNoResyncs?: boolean
  expectReconnects?: boolean
}

export interface ScenarioResult {
  differences: string[]
  mirrorSeq: number
  serverSeq: number
  vehicles: number
  resyncs: number
  snapshots: number
  /** Сколько раз открывалось соединение (первое, после снимков и после обрывов). */
  sockets: number
  batchesPerSecond: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(probe: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (probe()) return true
    await sleep(25)
  }
  return probe()
}

/** Сравнивает зеркало с истинным состоянием сервера; возвращает список расхождений. */
export function compare(mirror: Mirror, mock: MockServer): string[] {
  const diffs: string[] = []
  const world = mock.world

  const mirrorVehicles = new Map<string, Vehicle>(mirror.vehicles().map((v) => [v.vehicle_id, v]))
  if (mirrorVehicles.size !== world.vehicles.size) diffs.push(`машин: экран ${mirrorVehicles.size}, сервер ${world.vehicles.size}`)
  for (const expected of world.vehicles.values()) {
    const actual = mirrorVehicles.get(expected.vehicle_id)
    if (!actual) {
      diffs.push(`машины ${expected.vehicle_id} нет на экране`)
      continue
    }
    for (const field of ['x_m', 'y_m', 'state', 'point_id', 'last_seen', 'heading_deg', 'speed_kmh', 'name'] as const) {
      if (actual[field] !== expected[field]) diffs.push(`${expected.vehicle_id}.${field}: экран ${String(actual[field])}, сервер ${String(expected[field])}`)
    }
  }

  const points: Point[] = [...world.points.values()]
  if (mirror.points.size !== points.length) diffs.push(`пунктов: экран ${mirror.points.size}, сервер ${points.length}`)
  for (const expected of points) {
    const actual = mirror.points.get(expected.point_id)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) diffs.push(`пункт ${expected.point_id} (версия экрана ${actual?.version}, сервера ${expected.version})`)
  }

  const decisions: Decision[] = world.recentDecisions()
  if (mirror.decisions.size !== decisions.length) diffs.push(`решений: экран ${mirror.decisions.size}, сервер ${decisions.length}`)
  for (const expected of decisions) {
    const actual = mirror.decisions.get(expected.decision_id)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) diffs.push(`решение ${expected.decision_id} (экран ${actual?.status}/${actual?.version}, сервер ${expected.status}/${expected.version})`)
  }
  return diffs
}

/** Запускает движок против заглушки с отказами, замораживает сервер и сверяет состояние. */
export async function runScenario(scenario: Scenario, onCleanup: (fn: () => Promise<void>) => void): Promise<ScenarioResult> {
  const { faults, ...rest } = scenario.mock
  const mock = await startFast({
    decisionMinMs: 150,
    decisionMaxMs: 300,
    executeAfterMs: 1_500,
    heartbeatMs: 400,
    ...rest,
    ...(faults ? { faults: new Set(faults) as MockConfig['faults'] } : {}),
  })
  onCleanup(() => mock.close())

  configureHttp({ baseUrl: mock.url, timeoutMs: 5_000 })
  const mirror = new Mirror()
  const applier = new BatchApplier(mirror)
  let batches = 0
  let sockets = 0
  const startedAt = Date.now()

  const engine = new SyncEngine(
    {
      fetchSnapshot,
      openSocket: (since, handlers) => {
        sockets += 1
        return openSocket(mock.url, since, handlers)
      },
      emit: (output) => {
        if (output.type === 'status') return
        batches += 1
        const released = applier.apply(output)
        if (released) engine.recycle(released)
      },
    },
    { config: { resyncCooldownMs: 300, reorderWindowMs: 500, retryBaseMs: 100 } },
  )
  onCleanup(async () => engine.stop())
  engine.start()

  await sleep(scenario.runMs)

  // Сервер замирает; экран должен догнать тот же seq
  await mock.sim.pause()
  const serverSeq = mock.world.seq
  const converged = await waitFor(() => mirror.seq === serverSeq, 15_000)
  await sleep(150)
  const differences = compare(mirror, mock)
  if (!converged) differences.unshift(`экран не достиг seq сервера: ${mirror.seq} из ${serverSeq}`)

  const elapsed = (Date.now() - startedAt) / 1000
  engine.stop()
  const stats = engine.syncState.stats
  return {
    differences,
    mirrorSeq: mirror.seq,
    serverSeq,
    vehicles: mirror.vehicles().length,
    resyncs: stats.resyncs,
    snapshots: engine.syncState.snapshotsLoaded,
    sockets,
    batchesPerSecond: batches / elapsed,
  }
}
