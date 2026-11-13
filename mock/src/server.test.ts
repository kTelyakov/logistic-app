import type { Decision, Me, Point, Snapshot } from '@dispatch/contract'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, headers, pendingDecision, startFast, until } from './testing'
import type { MockServer } from './server'

let mock: MockServer | undefined
afterEach(async () => {
  await mock?.close()
  mock = undefined
})

async function debug(server: MockServer) {
  const res = await fetch(`${server.url}/debug/state`)
  return (await res.json()) as Snapshot & {
    commands: Record<string, { executions: number; replays: number; status: number; command: string; target: string }>
  }
}

describe('GET /api/me и /api/snapshot', () => {
  it('возвращает пользователя и площадку', async () => {
    mock = await startFast()
    const me = (await (await fetch(`${mock.url}/api/me`)).json()) as Me
    expect(me).toMatchObject({ user_id: 'u-7', role: 'dispatcher', site: { tz: 'Asia/Krasnoyarsk' } })
  })

  it('снимок содержит seq, время, машины, пункты и решения', async () => {
    mock = await startFast({ load: 150 })
    await pendingDecision(mock)
    const snapshot = (await (await fetch(`${mock.url}/api/snapshot`)).json()) as Snapshot
    expect(snapshot.vehicles).toHaveLength(150)
    expect(snapshot.points).toHaveLength(6)
    expect(snapshot.decisions.length).toBeGreaterThan(0)
    expect(Number.isInteger(snapshot.seq)).toBe(true)
    expect(new Date(snapshot.at).toISOString()).toBe(snapshot.at)
    expect(snapshot.vehicles[0]).toMatchObject({
      vehicle_id: expect.any(String),
      x_m: expect.any(Number),
      state: expect.any(String),
      last_seen: expect.any(String),
    })
  })

  it('поток после since начинается с seq+1 (снимок согласован с потоком)', async () => {
    mock = await startFast()
    const snapshot = (await (await fetch(`${mock.url}/api/snapshot`)).json()) as Snapshot
    const client = await connect(mock, snapshot.seq)
    const first = await until(() => client.messages.find((m) => m.seq !== undefined && m.type !== 'heartbeat'))
    expect(first.seq).toBe(snapshot.seq + 1)
    client.socket.close()
  })
})

describe('команды', () => {
  it('отмена ожидающего решения: 200, статус cancelled, версия +1', async () => {
    mock = await startFast()
    const d = await pendingDecision(mock)
    const res = await fetch(`${mock.url}/api/decisions/${d.decision_id}/cancel`, {
      method: 'POST',
      headers: headers('k-1', d.version),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Decision
    expect(body).toMatchObject({ decision_id: d.decision_id, status: 'cancelled', version: d.version + 1 })
  })

  it('повтор с тем же Idempotency-Key: тот же ответ, одно выполнение', async () => {
    mock = await startFast()
    const d = await pendingDecision(mock)
    const url = `${mock.url}/api/decisions/${d.decision_id}/cancel`
    const first = await fetch(url, { method: 'POST', headers: headers('k-repeat', d.version) })
    const second = await fetch(url, { method: 'POST', headers: headers('k-repeat', d.version) })
    expect(second.status).toBe(first.status)
    expect(await second.json()).toEqual(await first.json())

    const state = await debug(mock)
    expect(state.commands['k-repeat']).toMatchObject({
      command: 'cancel_decision',
      target: d.decision_id,
      executions: 1,
      replays: 1,
    })
    const stored = state.decisions.find((x) => x.decision_id === d.decision_id)
    expect(stored?.version).toBe(d.version + 1)
  })

  it('повтор с тем же ключом и устаревшей версией не выполняется второй раз', async () => {
    mock = await startFast()
    const d = await pendingDecision(mock)
    const url = `${mock.url}/api/decisions/${d.decision_id}/cancel`
    await fetch(url, { method: 'POST', headers: headers('k-same', d.version) })
    const replay = await fetch(url, { method: 'POST', headers: headers('k-same', d.version + 5) })
    expect(replay.status).toBe(200)
    expect((await debug(mock)).commands['k-same']?.executions).toBe(1)
  })

  it('отмена исполненного или истёкшего решения: 409 с актуальным решением', async () => {
    mock = await startFast({ executeAfterMs: 300 })
    const d = await pendingDecision(mock)
    const stale = d.version
    await until(() => mock?.world.decisions.get(d.decision_id)?.status !== 'pending')
    const res = await fetch(`${mock.url}/api/decisions/${d.decision_id}/cancel`, {
      method: 'POST',
      headers: headers('k-late', stale),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as Decision
    expect(['executed', 'expired']).toContain(body.status)
    expect(body.version).toBeGreaterThan(stale)
    expect((await debug(mock)).commands['k-late']?.executions).toBe(0)
  })

  it('устаревшая версия If-Match: 409 и решение не меняется', async () => {
    mock = await startFast()
    const d = await pendingDecision(mock)
    const res = await fetch(`${mock.url}/api/decisions/${d.decision_id}/cancel`, {
      method: 'POST',
      headers: headers('k-ver', d.version + 10),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as Decision).status).toBe('pending')
    expect(mock.world.decisions.get(d.decision_id)?.status).toBe('pending')
  })

  it('версия в кавычках (ETag-стиль) принимается', async () => {
    mock = await startFast()
    const d = await pendingDecision(mock)
    const res = await fetch(`${mock.url}/api/decisions/${d.decision_id}/cancel`, {
      method: 'POST',
      headers: headers('k-quoted', `"${d.version}"`),
    })
    expect(res.status).toBe(200)
  })

  it('без заголовков: 400; неизвестное решение: 404', async () => {
    mock = await startFast()
    const d = await pendingDecision(mock)
    const url = `${mock.url}/api/decisions/${d.decision_id}/cancel`
    expect((await fetch(url, { method: 'POST', headers: { 'If-Match': '1' } })).status).toBe(400)
    expect((await fetch(url, { method: 'POST', headers: { 'Idempotency-Key': 'x' } })).status).toBe(400)
    const missing = await fetch(`${mock.url}/api/decisions/d-nope/cancel`, {
      method: 'POST',
      headers: headers('k-404', 1),
    })
    expect(missing.status).toBe(404)
  })

  it('смена режима пункта: 200, версия +1, событие в потоке', async () => {
    mock = await startFast()
    const point = { ...(mock.world.points.get('p-2') as Point) }
    const client = await connect(mock, mock.world.seq)
    const res = await fetch(`${mock.url}/api/points/p-2/mode`, {
      method: 'POST',
      headers: headers('k-mode', point.version),
      body: JSON.stringify({ mode: 'manual' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Point
    expect(body).toMatchObject({ point_id: 'p-2', mode: 'manual' })
    expect(body.version).toBeGreaterThan(point.version)
    await until(() =>
      client.messages.find((m) => m.type === 'point' && (m.data as Point).point_id === 'p-2' && (m.data as Point).mode === 'manual'),
    )
    client.socket.close()
  })

  it('смена режима с устаревшей версией: 409 с актуальным пунктом; плохое тело: 400', async () => {
    mock = await startFast()
    const stale = await fetch(`${mock.url}/api/points/p-1/mode`, {
      method: 'POST',
      headers: headers('k-m409', 0),
      body: JSON.stringify({ mode: 'manual' }),
    })
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as Point).mode).toBe('auto')

    const bad = await fetch(`${mock.url}/api/points/p-1/mode`, {
      method: 'POST',
      headers: headers('k-m400', 1),
      body: JSON.stringify({ mode: 'turbo' }),
    })
    expect(bad.status).toBe(400)
  })

  it('ROLE=observer: /api/me говорит observer, команды отвечают 403 и не выполняются', async () => {
    mock = await startFast({ role: 'observer' })
    const me = (await (await fetch(`${mock.url}/api/me`)).json()) as Me
    expect(me.role).toBe('observer')
    const d = await pendingDecision(mock)

    const cancel = await fetch(`${mock.url}/api/decisions/${d.decision_id}/cancel`, {
      method: 'POST',
      headers: headers('k-obs', d.version),
    })
    expect(cancel.status).toBe(403)
    expect(await cancel.json()).toMatchObject({ message: expect.any(String) })

    const mode = await fetch(`${mock.url}/api/points/p-1/mode`, {
      method: 'POST',
      headers: headers('k-obs2', 1),
      body: JSON.stringify({ mode: 'manual' }),
    })
    expect(mode.status).toBe(403)
    expect(mock.world.decisions.get(d.decision_id)?.status).toBe('pending')
    expect(Object.keys((await debug(mock)).commands)).toEqual([])
  })
})

describe('GET /debug/state', () => {
  it('совпадает со снимком по составу и содержит счётчики выполнений', async () => {
    mock = await startFast()
    const d = await pendingDecision(mock)
    await fetch(`${mock.url}/api/decisions/${d.decision_id}/cancel`, {
      method: 'POST',
      headers: headers('k-dbg', d.version),
    })
    const state = await debug(mock)
    expect(state.vehicles).toHaveLength(60)
    expect(state.points).toHaveLength(6)
    expect(state.commands['k-dbg']).toMatchObject({ executions: 1, replays: 0, status: 200 })
  })
})

describe('POST /debug/pause и /debug/resume', () => {
  const post = (server: MockServer, path: string) => fetch(`${server.url}${path}`, { method: 'POST' })

  it('на паузе seq не растёт, состояние не меняется, heartbeat продолжается', async () => {
    mock = await startFast({ heartbeatMs: 100 })
    await until(() => mock && mock.world.seq > 20)
    const paused = await post(mock, '/debug/pause')
    expect(paused.status).toBe(200)
    expect(((await paused.json()) as { paused: boolean }).paused).toBe(true)

    const a = await debug(mock)
    const client = await connect(mock, a.seq)
    await new Promise((resolve) => setTimeout(resolve, 500))
    const b = await debug(mock)
    expect(b.seq).toBe(a.seq)
    expect(b.vehicles).toEqual(a.vehicles)
    expect((b as unknown as { paused: boolean }).paused).toBe(true)
    // новых данных нет, но heartbeat идёт и показывает замёрший seq
    expect(client.messages.filter((m) => m.type !== 'heartbeat')).toHaveLength(0)
    const beats = client.messages.filter((m) => m.type === 'heartbeat')
    expect(beats.length).toBeGreaterThan(2)
    expect(beats.every((m) => m.seq === a.seq)).toBe(true)
    client.socket.close()
  })

  it('повторные вызовы безопасны; после возобновления seq растёт', async () => {
    mock = await startFast()
    await post(mock, '/debug/pause')
    await post(mock, '/debug/pause')
    const frozen = mock.world.seq
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(mock.world.seq).toBe(frozen)

    expect((await post(mock, '/debug/resume')).status).toBe(200)
    expect((await post(mock, '/debug/resume')).status).toBe(200)
    await until(() => mock && mock.world.seq > frozen + 20)
    expect(((await debug(mock)) as unknown as { paused: boolean }).paused).toBe(false)
  })

  it('при FAULTS=slow пауза не задерживается', async () => {
    mock = await startFast({ faults: new Set(['slow']), slowDelayMs: 400 })
    const t0 = Date.now()
    await post(mock, '/debug/pause')
    expect(Date.now() - t0).toBeLessThan(250)
  })

  it('после возобновления обновления машин не приходят одним всплеском', async () => {
    mock = await startFast({ load: 400, tickMs: 50 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await post(mock, '/debug/pause')
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    const client = await connect(mock, mock.world.seq)
    await post(mock, '/debug/resume')
    await new Promise((resolve) => setTimeout(resolve, 500))
    client.socket.close()
    const vehicles = client.messages.filter((m) => m.type === 'vehicle').length
    // за полсекунды обновляется порядка половины машин, а не все 400 разом
    expect(vehicles).toBeGreaterThan(80)
    expect(vehicles).toBeLessThan(320)
  })

  it('команды выполняются и на паузе', async () => {
    mock = await startFast()
    const d = await pendingDecision(mock)
    await post(mock, '/debug/pause')
    const res = await fetch(`${mock.url}/api/decisions/${d.decision_id}/cancel`, {
      method: 'POST',
      headers: headers('k-paused', d.version),
    })
    expect(res.status).toBe(200)
  })
})
