import type { DataMessage, Decision, Point, Snapshot, Vehicle, WsMessage } from '@dispatch/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SocketHandle, SocketHandlers } from '../api/openSocket'
import { BatchApplier } from '../client/applyBatch'
import type { BatchOutput, EngineOutput, StatusOutput } from '../protocol'
import { Mirror } from '../testing/mirror'
import { SyncEngine, type EngineDeps } from './SyncEngine'

const NOW = '2026-10-01T04:00:00.000Z'

const vehicle = (n: number, patch: Partial<Vehicle> = {}): Vehicle => ({
  vehicle_id: `v-${n}`, name: `Т-${n}`, x_m: n, y_m: n * 2, heading_deg: 0, speed_kmh: 0,
  state: 'idle', point_id: 'p-1', last_seen: NOW, ...patch,
})
const point = (n: number, patch: Partial<Point> = {}): Point => ({
  point_id: `p-${n}`, name: `Пункт ${n}`, x_m: 0, y_m: 0, mode: 'auto', version: 1, queue: [], ...patch,
})
const decision = (n: number, patch: Partial<Decision> = {}): Decision => ({
  decision_id: `d-${n}`, vehicle_id: 'v-1', from_point: 'p-1', to_point: 'p-2', gain_s: 10, reason: '',
  status: 'pending', created_at: NOW, execute_at: NOW, version: 1, ...patch,
})
const snapshot = (seq: number, vehicles: Vehicle[] = [vehicle(1), vehicle(2)]): Snapshot => ({
  seq, at: NOW, vehicles, points: [point(1), point(2)], decisions: [decision(1)],
})
const vehicleMsg = (seq: number, v: Vehicle): DataMessage => ({ seq, at: NOW, type: 'vehicle', data: v })
const pointMsg = (seq: number, p: Point): DataMessage => ({ seq, at: NOW, type: 'point', data: p })
const decisionMsg = (seq: number, d: Decision): DataMessage => ({ seq, at: NOW, type: 'decision', data: d })

interface Harness {
  engine: SyncEngine
  outputs: EngineOutput[]
  batches: BatchOutput[]
  statuses: StatusOutput[]
  fetches: number
  resolveFetch(snapshot: Snapshot): Promise<void>
  failFetch(): Promise<void>
  sockets: Array<{ since: number; handlers: SocketHandlers; closed: boolean }>
  send(...messages: WsMessage[]): Promise<void>
  mirror: Mirror
  apply(batch: BatchOutput): void
}

function harness(options: ConstructorParameters<typeof SyncEngine>[1] = {}): Harness {
  const outputs: EngineOutput[] = []
  const sockets: Harness['sockets'] = []
  const waiting: Array<{ resolve(s: Snapshot): void; reject(): void }> = []
  const mirror = new Mirror()
  const applier = new BatchApplier(mirror)
  let fetches = 0

  const deps: EngineDeps = {
    fetchSnapshot: () => {
      fetches += 1
      return new Promise<Snapshot>((resolve, reject) => waiting.push({ resolve, reject: () => reject(new Error('сеть')) }))
    },
    openSocket: (since: number, handlers: SocketHandlers): SocketHandle => {
      const entry = { since, handlers, closed: false }
      sockets.push(entry)
      return { close: () => { entry.closed = true } }
    },
    emit: (output) => outputs.push(output),
  }
  // Пауза между снимками проверена в тестах ядра; здесь она мешает сценариям в первую секунду
  const engine = new SyncEngine(deps, { ...options, config: { resyncCooldownMs: 0, ...options.config } })
  const h: Harness = {
    engine, outputs, mirror, sockets,
    get batches() { return outputs.filter((o): o is BatchOutput => o.type === 'batch') },
    get statuses() { return outputs.filter((o): o is StatusOutput => o.type === 'status') },
    get fetches() { return fetches },
    async resolveFetch(s) { waiting.shift()?.resolve(s); await vi.advanceTimersByTimeAsync(0) },
    async failFetch() { waiting.shift()?.reject(); await vi.advanceTimersByTimeAsync(0) },
    async send(...messages) { sockets.at(-1)?.handlers.onMessages(messages); await vi.advanceTimersByTimeAsync(0) },
    apply(batch) {
      const released = applier.apply(batch)
      if (released) engine.recycle(released)
    },
  }
  return h
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

async function started(options?: ConstructorParameters<typeof SyncEngine>[1]): Promise<Harness> {
  const h = harness(options)
  h.engine.start()
  await h.resolveFetch(snapshot(10))
  return h
}

describe('запуск', () => {
  it('start запрашивает снимок; после него открывается сокет с since=seq', async () => {
    const h = harness()
    h.engine.start()
    expect(h.fetches).toBe(1)
    expect(h.sockets).toHaveLength(0)
    await h.resolveFetch(snapshot(10))
    expect(h.sockets).toHaveLength(1)
    expect(h.sockets[0]?.since).toBe(10)
    h.engine.stop()
  })

  it('первый пакет содержит замену сущностей, кадр машин и справочники', async () => {
    const h = await started()
    await vi.advanceTimersByTimeAsync(60)
    expect(h.batches).toHaveLength(1)
    const batch = h.batches[0] as BatchOutput
    expect(batch.seq).toBe(10)
    expect(batch.entities?.replace?.points).toHaveLength(2)
    expect(batch.entities?.replace?.decisions).toHaveLength(1)
    expect(batch.vehicles?.frame.count).toBe(2)
    expect(batch.vehicles?.tables?.ids).toEqual(['v-1', 'v-2'])
    h.apply(batch)
    expect(h.mirror.vehicles().map((v) => v.vehicle_id)).toEqual(['v-1', 'v-2'])
    expect(h.mirror.seq).toBe(10)
    h.engine.stop()
  })

  it('без изменений пакеты не отправляются', async () => {
    const h = await started()
    await vi.advanceTimersByTimeAsync(60)
    h.apply(h.batches[0] as BatchOutput)
    const sent = h.batches.length
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.batches.length).toBe(sent)
    h.engine.stop()
  })
})

describe('пакеты', () => {
  it('сообщения собираются в один пакет раз в flushMs независимо от их числа', async () => {
    const h = await started()
    await vi.advanceTimersByTimeAsync(60)
    h.apply(h.batches[0] as BatchOutput)
    const before = h.batches.length
    for (let seq = 11; seq <= 60; seq++) await h.send(vehicleMsg(seq, vehicle(1, { x_m: seq })))
    expect(h.batches.length).toBe(before) // flushMs ещё не прошёл
    await vi.advanceTimersByTimeAsync(60)
    expect(h.batches.length).toBe(before + 1)
    const batch = h.batches.at(-1) as BatchOutput
    expect(batch.seq).toBe(60)
    h.apply(batch)
    expect(h.mirror.vehicles().find((v) => v.vehicle_id === 'v-1')?.x_m).toBe(60)
    h.engine.stop()
  })

  it('сообщения о пунктах и решениях дедуплицируются по id: остаётся последнее', async () => {
    const h = await started()
    await vi.advanceTimersByTimeAsync(60)
    h.apply(h.batches[0] as BatchOutput)
    await h.send(
      decisionMsg(11, decision(1, { status: 'pending', version: 1 })),
      decisionMsg(12, decision(2)),
      decisionMsg(13, decision(1, { status: 'cancelled', version: 2 })),
      pointMsg(14, point(1, { mode: 'manual', version: 2 })),
    )
    await vi.advanceTimersByTimeAsync(60)
    const batch = h.batches.at(-1) as BatchOutput
    expect(batch.entities?.messages).toHaveLength(3)
    expect(batch.vehicles).toBeUndefined() // машины не менялись
    h.apply(batch)
    expect(h.mirror.decisions.get('d-1')).toMatchObject({ status: 'cancelled', version: 2 })
    expect(h.mirror.decisions.has('d-2')).toBe(true)
    expect(h.mirror.points.get('p-1')?.mode).toBe('manual')
    h.engine.stop()
  })

  it('справочники строк приходят только при изменении набора машин', async () => {
    const h = await started()
    await vi.advanceTimersByTimeAsync(60)
    h.apply(h.batches[0] as BatchOutput)
    await h.send(vehicleMsg(11, vehicle(1, { x_m: 5 })))
    await vi.advanceTimersByTimeAsync(60)
    expect((h.batches.at(-1) as BatchOutput).vehicles?.tables).toBeUndefined()
    h.apply(h.batches.at(-1) as BatchOutput)
    await h.send(vehicleMsg(12, vehicle(3)))
    await vi.advanceTimersByTimeAsync(60)
    expect((h.batches.at(-1) as BatchOutput).vehicles?.tables?.ids).toEqual(['v-1', 'v-2', 'v-3'])
    h.engine.stop()
  })

  it('замена снимком отбрасывает накопленное до неё', async () => {
    const h = await started()
    await vi.advanceTimersByTimeAsync(60)
    h.apply(h.batches[0] as BatchOutput)
    await h.send(decisionMsg(11, decision(7)), vehicleMsg(12, vehicle(1, { x_m: 777 })))
    // дыра: reset приводит к новому снимку до отправки пакета
    await h.send({ type: 'reset' })
    await h.resolveFetch({ ...snapshot(50, [vehicle(1, { x_m: 1 }), vehicle(9)]), decisions: [decision(1)] })
    await vi.advanceTimersByTimeAsync(60)
    const batch = h.batches.at(-1) as BatchOutput
    expect(batch.seq).toBe(50)
    expect(batch.entities?.messages).toEqual([])
    h.apply(batch)
    expect(h.mirror.decisions.has('d-7')).toBe(false)
    expect(h.mirror.vehicles().map((v) => v.vehicle_id).sort()).toEqual(['v-1', 'v-9'])
    expect(h.mirror.vehicles().find((v) => v.vehicle_id === 'v-1')?.x_m).toBe(1)
    h.engine.stop()
  })
})

describe('обратное давление и пул кадров', () => {
  async function pushUpdate(h: Harness, seq: number, x: number) {
    await h.send(vehicleMsg(seq, vehicle(1, { x_m: x })))
    await vi.advanceTimersByTimeAsync(60)
  }

  it('при трёх кадрах в полёте новые пакеты не отправляются; после возврата уходит один актуальный', async () => {
    const h = await started({ maxFramesInFlight: 3 })
    await vi.advanceTimersByTimeAsync(60) // кадр 1
    await pushUpdate(h, 11, 1) // кадр 2
    await pushUpdate(h, 12, 2) // кадр 3
    expect(h.batches).toHaveLength(3)

    await pushUpdate(h, 13, 3)
    await pushUpdate(h, 14, 4)
    await pushUpdate(h, 15, 5)
    expect(h.batches, 'основной поток не вернул кадры: пакетов больше нет').toHaveLength(3)
    // воркер при этом продолжает применять сообщения
    expect(h.engine.syncState.lastSeq).toBe(15)

    // основной поток применил первый кадр и вернул его
    h.apply(h.batches[0] as BatchOutput)
    h.apply(h.batches[1] as BatchOutput) // возвращает кадр 1
    await vi.advanceTimersByTimeAsync(60)
    expect(h.batches).toHaveLength(4)
    const latest = h.batches[3] as BatchOutput
    expect(latest.seq).toBe(15)
    h.apply(latest)
    expect(h.mirror.vehicles().find((v) => v.vehicle_id === 'v-1')?.x_m).toBe(5)
    h.engine.stop()
  })

  it('возвращённые буферы используются повторно', async () => {
    const h = await started()
    await vi.advanceTimersByTimeAsync(60)
    const first = h.batches[0] as BatchOutput
    h.apply(first)
    await pushUpdate(h, 11, 1)
    const second = h.batches[1] as BatchOutput
    h.apply(second) // возвращает кадр first
    await pushUpdate(h, 12, 2)
    const third = h.batches[2] as BatchOutput
    expect(third.vehicles?.frame.columns).toBe(first.vehicles?.frame.columns)
    h.engine.stop()
  })
})

describe('статус и время сервера', () => {
  it('статус отправляется периодически и при смене фазы', async () => {
    const h = harness()
    h.engine.start()
    expect(h.statuses.at(-1)?.phase).toBe('loading')
    await h.resolveFetch(snapshot(10))
    expect(h.statuses.at(-1)).toMatchObject({ phase: 'live', seq: 10, snapshots: 1 })
    const count = h.statuses.length
    await vi.advanceTimersByTimeAsync(1_100)
    expect(h.statuses.length).toBeGreaterThanOrEqual(count + 2)
    h.engine.stop()
  })

  it('idleMs растёт, пока от сервера ничего нет, и сбрасывается сообщением', async () => {
    const h = await started()
    await vi.advanceTimersByTimeAsync(3_000)
    expect((h.statuses.at(-1) as StatusOutput).idleMs).toBeGreaterThanOrEqual(2_500)
    await h.send({ type: 'heartbeat', seq: 10, at: NOW })
    await vi.advanceTimersByTimeAsync(600)
    expect((h.statuses.at(-1) as StatusOutput).idleMs).toBeLessThan(1_000)
    h.engine.stop()
  })

  it('сдвиг часов оценивается по heartbeat', async () => {
    vi.setSystemTime(Date.parse(NOW) - 2 * 3_600_000) // часы браузера отстают на 2 часа
    const h = await started()
    await h.send({ type: 'heartbeat', seq: 10, at: NOW })
    await vi.advanceTimersByTimeAsync(600)
    const status = h.statuses.at(-1) as StatusOutput
    expect(status.synced).toBe(true)
    expect(Math.abs(status.offsetMs - 2 * 3_600_000)).toBeLessThan(2_000)
    h.engine.stop()
  })
})

describe('отказы', () => {
  it('потерянное сообщение: после окна запрашивается новый снимок', async () => {
    const h = await started()
    await h.send(vehicleMsg(12, vehicle(1))) // seq 11 потерян
    expect(h.fetches).toBe(1)
    await vi.advanceTimersByTimeAsync(700)
    expect(h.fetches).toBe(2)
    await h.resolveFetch(snapshot(30))
    expect(h.engine.syncState.lastSeq).toBe(30)
    expect(h.sockets.at(-1)?.since).toBe(30)
    expect(h.sockets[0]?.closed).toBe(true)
    h.engine.stop()
  })

  it('обрыв сокета: переподключение с since=lastSeq после задержки', async () => {
    const h = await started()
    await h.send(vehicleMsg(11, vehicle(1)))
    h.sockets[0]?.handlers.onClose()
    expect(h.sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(h.sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(h.sockets).toHaveLength(2)
    expect(h.sockets[1]?.since).toBe(11)
    h.engine.stop()
  })

  it('закрытие старого соединения после замены не считается обрывом', async () => {
    const h = await started()
    await h.send({ type: 'reset' })
    await h.resolveFetch(snapshot(40))
    const stale = h.sockets[0]
    stale?.handlers.onClose() // поздний close уже заменённого соединения
    await vi.advanceTimersByTimeAsync(2_000)
    expect(h.sockets).toHaveLength(2)
    expect(h.engine.syncState.phase).toBe('live')
    h.engine.stop()
  })

  it('сообщения заменённого соединения игнорируются', async () => {
    const h = await started()
    await h.send({ type: 'reset' })
    await h.resolveFetch(snapshot(40))
    h.sockets[0]?.handlers.onMessages([vehicleMsg(41, vehicle(1, { x_m: 999 }))])
    expect(h.engine.syncState.lastSeq).toBe(40)
    h.engine.stop()
  })

  it('ошибка снимка: повтор после задержки', async () => {
    const h = harness()
    h.engine.start()
    await h.failFetch()
    expect(h.fetches).toBe(1)
    await vi.advanceTimersByTimeAsync(600)
    expect(h.fetches).toBe(2)
    h.engine.stop()
  })
})

describe('остановка', () => {
  it('stop закрывает сокет и прекращает таймеры', async () => {
    const h = await started()
    h.engine.stop()
    expect(h.sockets[0]?.closed).toBe(true)
    const outputs = h.outputs.length
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.outputs.length).toBe(outputs)
  })

  it('после stop события игнорируются', async () => {
    const h = await started()
    h.engine.stop()
    await h.send(vehicleMsg(11, vehicle(1)))
    expect(h.engine.syncState.lastSeq).toBe(10)
  })
})
