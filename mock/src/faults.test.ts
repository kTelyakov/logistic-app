import type { Decision, Snapshot } from '@dispatch/contract'
import { afterEach, describe, expect, it } from 'vitest'
import { executesBeforeDelay, faultDecision, FaultySender } from './faults'
import type { MockServer } from './server'
import { connect, headers, pendingDecision, startFast, until } from './testing'

let mock: MockServer | undefined
afterEach(async () => {
  await mock?.close()
  mock = undefined
})

const ALL = new Set(['drop', 'dup', 'reorder'] as const)

describe('faultDecision', () => {
  it('зависит только от seed и seq', () => {
    const a = Array.from({ length: 500 }, (_, seq) => faultDecision(7, seq, ALL, 0.2))
    const b = Array.from({ length: 500 }, (_, seq) => faultDecision(7, seq, ALL, 0.2))
    expect(a).toEqual(b)
  })

  it('другой seed даёт другую последовательность', () => {
    const a = Array.from({ length: 500 }, (_, seq) => faultDecision(1, seq, ALL, 0.2))
    const b = Array.from({ length: 500 }, (_, seq) => faultDecision(2, seq, ALL, 0.2))
    expect(a).not.toEqual(b)
  })

  it('доля отказов близка к заданной', () => {
    const decisions = Array.from({ length: 20_000 }, (_, seq) => faultDecision(3, seq, ALL, 0.1))
    for (const kind of ['drop', 'dup', 'reorder'] as const) {
      const share = decisions.filter((d) => d[kind]).length / decisions.length
      expect(share).toBeGreaterThan(0.08)
      expect(share).toBeLessThan(0.12)
    }
  })

  it('без включённых режимов отказов нет', () => {
    const none = Array.from({ length: 1000 }, (_, seq) => faultDecision(1, seq, new Set(), 1))
    expect(none.every((d) => !d.drop && !d.dup && !d.reorder)).toBe(true)
  })

  it('режим включается независимо от остальных', () => {
    const only = Array.from({ length: 1000 }, (_, seq) => faultDecision(1, seq, new Set(['drop'] as const), 1))
    expect(only.every((d) => d.drop && !d.dup && !d.reorder)).toBe(true)
  })
})

describe('FaultySender', () => {
  function collect(faults: ReadonlySet<'drop' | 'dup' | 'reorder'>, rate: number) {
    const out: string[] = []
    const sender = new FaultySender((json) => out.push(json), 1, faults, rate)
    return { out, sender }
  }

  it('drop: сообщения пропадают', () => {
    const { out, sender } = collect(new Set(['drop'] as const), 1)
    for (let seq = 1; seq <= 5; seq++) sender.push(seq, `m${seq}`)
    expect(out).toEqual([])
  })

  it('dup: сообщение приходит дважды подряд', () => {
    const { out, sender } = collect(new Set(['dup'] as const), 1)
    sender.push(1, 'm1')
    sender.push(2, 'm2')
    expect(out).toEqual(['m1', 'm1', 'm2', 'm2'])
  })

  it('reorder: удержанное сообщение выходит после следующего', () => {
    const out: string[] = []
    // reorder только для seq=1
    const sender = new FaultySender((j) => out.push(j), 1, new Set(['reorder'] as const), 1)
    sender.push(1, 'm1')
    expect(out).toEqual([])
    sender.push(2, 'm2')
    expect(out).toEqual(['m2', 'm1'])
    sender.dispose()
  })

  it('reorder: если следующего нет, удержанное уходит по таймеру и не теряется', async () => {
    const { out, sender } = collect(new Set(['reorder'] as const), 1)
    sender.push(1, 'm1')
    await until(() => out.length === 1)
    expect(out).toEqual(['m1'])
  })

  it('без отказов порядок и содержимое сохраняются', () => {
    const { out, sender } = collect(new Set(), 0.5)
    for (let seq = 1; seq <= 5; seq++) sender.push(seq, `m${seq}`)
    expect(out).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
  })
})

describe('FAULTS=drop,dup,reorder в потоке', () => {
  it('клиент видит пропуски, повторы и перестановки, а истинное состояние не искажено', async () => {
    mock = await startFast({ faults: new Set(['drop', 'dup', 'reorder']), faultRate: 0.15, seed: 11 })
    const client = await connect(mock, mock.world.seq)
    await until(() => client.messages.filter((m) => m.seq !== undefined).length > 400, 6_000)
    client.socket.close()

    const seqs = client.messages.filter((m) => m.type !== 'heartbeat' && m.seq !== undefined).map((m) => m.seq as number)
    const unique = new Set(seqs)
    const sorted = [...unique].sort((a, b) => a - b)
    const gaps = sorted.some((s, i) => i > 0 && s - (sorted[i - 1] as number) > 1)
    const duplicates = seqs.length > unique.size
    const outOfOrder = seqs.some((s, i) => i > 0 && s < (seqs[i - 1] as number))
    expect(gaps).toBe(true)
    expect(duplicates).toBe(true)
    expect(outOfOrder).toBe(true)

    // Что дошло, то совпадает с журналом сервера побайтно: искажается доставка, а не содержимое
    const journal = new Map(mock.world.since(sorted[0] as number - 1)?.map((e) => [e.seq, e.json]))
    for (const message of client.messages) {
      if (message.type === 'heartbeat' || message.seq === undefined) continue
      expect(message).toEqual(JSON.parse(journal.get(message.seq) as string))
    }

    // Истинное состояние на сервере: seq без пропусков
    const all = mock.world.since(0) ?? []
    all.forEach((entry, i) => expect(entry.seq).toBe((all[0]?.seq ?? 0) + i))
  })

  it('два соединения теряют одни и те же seq (отказы воспроизводимы)', async () => {
    mock = await startFast({ faults: new Set(['drop']), faultRate: 0.2, seed: 5 })
    const since = mock.world.seq
    const a = await connect(mock, since)
    const b = await connect(mock, since)
    await until(() => a.messages.length > 200 && b.messages.length > 200, 6_000)
    a.socket.close()
    b.socket.close()
    const top = Math.min(
      Math.max(...a.messages.map((m) => m.seq ?? 0)),
      Math.max(...b.messages.map((m) => m.seq ?? 0)),
    )
    const seen = (client: typeof a) =>
      new Set(client.messages.filter((m) => m.type !== 'heartbeat' && (m.seq ?? 0) <= top).map((m) => m.seq))
    expect(seen(a)).toEqual(seen(b))
  })

  it('перед запросом снимка seq совпадает с журналом (потерянное можно восстановить снимком)', async () => {
    mock = await startFast({ faults: new Set(['drop', 'dup', 'reorder']), faultRate: 0.3, seed: 2 })
    const snapshot = (await (await fetch(`${mock.url}/api/snapshot`)).json()) as Snapshot
    expect(snapshot.seq).toBe(mock.world.seq)
    expect(snapshot.vehicles).toHaveLength(60)
  })
})

describe('FAULTS=slow', () => {
  function keyFor(before: boolean, seed: number): string {
    for (let i = 0; i < 1000; i++) {
      const key = `slow-${before ? 'before' : 'after'}-${i}`
      if (executesBeforeDelay(seed, key) === before) return key
    }
    throw new Error('ключ не найден')
  }

  it('задерживает HTTP, кроме /debug', async () => {
    mock = await startFast({ faults: new Set(['slow']), slowDelayMs: 250 })
    const t0 = Date.now()
    await fetch(`${mock.url}/api/me`)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240)

    const t1 = Date.now()
    await fetch(`${mock.url}/debug/state`)
    expect(Date.now() - t1).toBeLessThan(200)
  })

  for (const before of [true, false]) {
    it(`таймаут клиента и повтор с тем же ключом: одно выполнение (${before ? 'выполнено до задержки' : 'выполнено после задержки'})`, async () => {
      mock = await startFast({ faults: new Set(['slow']), slowDelayMs: 300, seed: 3 })
      const d = await pendingDecision(mock)
      const key = keyFor(before, 3)
      const url = `${mock.url}/api/decisions/${d.decision_id}/cancel`

      // Первая попытка: клиент не дожидается ответа
      const controller = new AbortController()
      const first = fetch(url, { method: 'POST', headers: headers(key, d.version), signal: controller.signal })
      first.catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 100))
      controller.abort()

      // Повтор с тем же ключом, пока первая ещё обрабатывается на сервере
      const retry = await fetch(url, { method: 'POST', headers: headers(key, d.version) })
      expect(retry.status).toBe(200)
      expect(((await retry.json()) as Decision).status).toBe('cancelled')

      const state = (await (await fetch(`${mock.url}/debug/state`)).json()) as {
        commands: Record<string, { executions: number }>
        decisions: Decision[]
      }
      expect(state.commands[key]?.executions).toBe(1)
      expect(state.decisions.find((x) => x.decision_id === d.decision_id)?.status).toBe('cancelled')
    })
  }

  it('команда выполняется на сервере, хотя клиент получил таймаут', async () => {
    mock = await startFast({ faults: new Set(['slow']), slowDelayMs: 400, seed: 3 })
    const d = await pendingDecision(mock)
    const key = keyFor(true, 3)
    const controller = new AbortController()
    const request = fetch(`${mock.url}/api/decisions/${d.decision_id}/cancel`, {
      method: 'POST',
      headers: headers(key, d.version),
      signal: controller.signal,
    })
    request.catch(() => {})
    setTimeout(() => controller.abort(), 100)
    // К моменту таймаута клиента сервер уже выполнил команду
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(mock.world.decisions.get(d.decision_id)?.status).toBe('cancelled')
  })
})

describe('FAULTS=reset', () => {
  it('рвёт соединение и отвечает reset на переподключение, дальше работает как обычно', async () => {
    mock = await startFast({ faults: new Set(['reset']), resetIntervalMs: 300 })
    const first = await connect(mock, mock.world.seq)
    await first.closed

    const lastSeq = Math.max(0, ...first.messages.map((m) => m.seq ?? 0))
    const second = await connect(mock, lastSeq)
    await until(() => second.messages.length > 0)
    expect(second.messages[0]).toEqual({ type: 'reset' })
    second.socket.close()

    const third = await connect(mock, mock.world.seq)
    await until(() => third.messages.some((m) => m.type === 'vehicle'))
    expect(third.messages.some((m) => m.type === 'reset')).toBe(false)
    third.socket.close()
  })
})

describe('FAULTS=stale', () => {
  it('часть машин перестаёт обновляться, last_seen в снимке отстаёт', async () => {
    mock = await startFast({
      faults: new Set(['stale']),
      load: 50,
      staleSilentMs: 100_000,
      staleActiveMs: 1,
    })
    await new Promise((resolve) => setTimeout(resolve, 1_300))
    const snapshot = (await (await fetch(`${mock.url}/api/snapshot`)).json()) as Snapshot
    const age = (id: string) => Date.parse(snapshot.at) - Date.parse(snapshot.vehicles.find((v) => v.vehicle_id === id)?.last_seen as string)
    expect(age('v-01')).toBeGreaterThan(1_000) // из молчащей группы
    expect(age('v-02')).toBeLessThan(1_500)
  })
})

describe('равномерность решений', () => {
  it('на коротком окне подряд идущих seq отказы встречаются при любом seed', () => {
    // Регрессия: без перемешивания битов первые сотни seq могли не содержать ни одного отказа
    for (const seed of [0, 1, 2, 5, 11, 42, 1000]) {
      const first200 = Array.from({ length: 200 }, (_, seq) => faultDecision(seed, seq + 1, ALL, 0.15))
      for (const kind of ['drop', 'dup', 'reorder'] as const) {
        const count = first200.filter((d) => d[kind]).length
        expect(count, `seed=${seed} ${kind}`).toBeGreaterThan(10)
        expect(count, `seed=${seed} ${kind}`).toBeLessThan(55)
      }
    }
  })
})
