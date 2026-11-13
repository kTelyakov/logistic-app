import { afterEach, describe, expect, it } from 'vitest'
import type { MockServer } from './server'
import { connect, startFast, until } from './testing'

let mock: MockServer | undefined
afterEach(async () => {
  await mock?.close()
  mock = undefined
})

describe('WebSocket /ws?since', () => {
  it('seq в потоке растёт на 1 без пропусков и повторов', async () => {
    mock = await startFast()
    const client = await connect(mock, mock.world.seq)
    await until(() => client.messages.filter((m) => m.type !== 'heartbeat').length > 120)
    client.socket.close()
    const seqs = client.messages.filter((m) => m.type !== 'heartbeat').map((m) => m.seq as number)
    seqs.forEach((seq, i) => expect(seq).toBe((seqs[0] as number) + i))
  })

  it('сообщения несут время сервера, полный объект и тип', async () => {
    mock = await startFast()
    const client = await connect(mock, mock.world.seq)
    const vehicle = await until(() => client.messages.find((m) => m.type === 'vehicle'))
    client.socket.close()
    expect(new Date(vehicle.at as string).toISOString()).toBe(vehicle.at)
    expect(vehicle.data).toMatchObject({ vehicle_id: expect.any(String), x_m: expect.any(Number), state: expect.any(String) })
  })

  it('подключение с прошлым since отдаёт пропущенное из журнала по порядку', async () => {
    mock = await startFast()
    const since = mock.world.seq
    await until(() => mock && mock.world.seq > since + 50)
    const client = await connect(mock, since)
    await until(() => client.messages.length >= 50)
    client.socket.close()
    const seqs = client.messages.filter((m) => m.type !== 'heartbeat').map((m) => m.seq as number)
    expect(seqs[0]).toBe(since + 1)
    seqs.forEach((seq, i) => expect(seq).toBe(since + 1 + i))
  })

  it('since больше текущего seq (сервер перезапущен): reset', async () => {
    mock = await startFast()
    const client = await connect(mock, mock.world.seq + 100_000)
    await until(() => client.messages.length > 0)
    expect(client.messages[0]).toEqual({ type: 'reset' })
    client.socket.close()
  })

  it('since старше, чем помнит журнал: reset, соединение остаётся рабочим', async () => {
    mock = await startFast({ journalSize: 20 })
    await until(() => mock && mock.world.seq > 200)
    const client = await connect(mock, 0)
    await until(() => client.messages.length > 0)
    expect(client.messages[0]).toEqual({ type: 'reset' })
    // после reset поток продолжается живыми сообщениями
    await until(() => client.messages.some((m) => m.type === 'vehicle'))
    client.socket.close()
  })

  it('без параметра since: только новые сообщения, без повтора истории', async () => {
    mock = await startFast()
    await until(() => mock && mock.world.seq > 30)
    const before = mock.world.seq
    const client = await connect(mock, undefined)
    const first = await until(() => client.messages.find((m) => m.type === 'vehicle'))
    client.socket.close()
    expect(first.seq as number).toBeGreaterThan(before)
  })

  it('пустой since закрывает соединение', async () => {
    mock = await startFast()
    const client = await connect(mock, '')
    await client.closed
  })

  it('некорректный since закрывает соединение', async () => {
    mock = await startFast()
    const client = await connect(mock, 'abc')
    await client.closed
  })

  it('heartbeat раз в интервал: seq и время сервера', async () => {
    mock = await startFast({ heartbeatMs: 100 })
    const client = await connect(mock, mock.world.seq)
    await until(() => client.messages.filter((m) => m.type === 'heartbeat').length >= 3)
    client.socket.close()
    const beats = client.messages.filter((m) => m.type === 'heartbeat')
    for (const beat of beats) {
      expect(Number.isInteger(beat.seq)).toBe(true)
      expect(new Date(beat.at as string).toISOString()).toBe(beat.at)
    }
    const times = beats.map((b) => Date.parse(b.at as string))
    expect(times[2] as number).toBeGreaterThan(times[0] as number)
  })

  it('heartbeat не расходует seq и показывает актуальный seq сервера', async () => {
    mock = await startFast({ heartbeatMs: 100 })
    const client = await connect(mock, mock.world.seq)
    await until(() => client.messages.some((m) => m.type === 'heartbeat'))
    const beat = client.messages.find((m) => m.type === 'heartbeat')
    client.socket.close()
    expect(beat?.seq as number).toBeLessThanOrEqual(mock.world.seq)
    expect(beat?.seq as number).toBeGreaterThan(0)
  })
})

describe('LOAD', () => {
  it('каждая машина обновляется раз в секунду, шаг симуляции не отстаёт', async () => {
    const load = 3_000
    mock = await startFast({ load, tickMs: 100 })
    const client = await connect(mock, mock.world.seq)
    const started = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    const elapsed = (Date.now() - started) / 1000
    client.socket.close()

    const perVehicle = new Map<string, number>()
    for (const m of client.messages) {
      if (m.type === 'vehicle') {
        const id = (m.data as { vehicle_id: string }).vehicle_id
        perVehicle.set(id, (perVehicle.get(id) ?? 0) + 1)
      }
    }
    expect(perVehicle.size).toBe(load)
    const rate = [...perVehicle.values()].reduce((a, b) => a + b, 0) / load / elapsed
    expect(rate).toBeGreaterThan(0.8)
    expect(rate).toBeLessThan(1.3)
    expect(mock.sim.stats.maxTickMs).toBeLessThan(250)
  })
})
