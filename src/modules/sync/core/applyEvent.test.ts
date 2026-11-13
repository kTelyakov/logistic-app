import type { DataMessage, Snapshot, WsMessage } from '@dispatch/contract'
import { describe, expect, it } from 'vitest'
import { applyEvent, createSyncState } from './applyEvent'
import { DEFAULT_SYNC_CONFIG, type SyncConfig, type SyncEffect, type SyncState } from './types'

const CONFIG: SyncConfig = { ...DEFAULT_SYNC_CONFIG, reorderWindowMs: 500, resyncCooldownMs: 1_000 }

const data = (seq: number): DataMessage => ({
  seq,
  at: '2026-10-01T04:00:00Z',
  type: 'vehicle',
  data: {
    vehicle_id: 'v-1',
    name: 'Т-1',
    x_m: seq,
    y_m: 0,
    heading_deg: 0,
    speed_kmh: 0,
    state: 'idle',
    point_id: 'p-1',
    last_seen: '2026-10-01T04:00:00Z',
  },
})
const heartbeat = (seq: number): WsMessage => ({ type: 'heartbeat', seq, at: '2026-10-01T04:00:00Z' })
const reset: WsMessage = { type: 'reset' }
const snapshot = (seq: number): Snapshot => ({ seq, at: '2026-10-01T04:00:00Z', vehicles: [], points: [], decisions: [] })

const types = (effects: SyncEffect[]) => effects.map((e) => e.type)
const appliedSeqs = (effects: SyncEffect[]) =>
  effects.flatMap((e) => (e.type === 'apply' ? e.messages.map((m) => m.seq) : []))

/** Состояние после первого снимка с seq=10. Старт задолго до проверяемых моментов: пауза между снимками уже прошла. */
function live(seq = 10): SyncState {
  const state = createSyncState()
  applyEvent(state, { type: 'start', now: -10_000 }, CONFIG)
  applyEvent(state, { type: 'snapshot', snapshot: snapshot(seq), now: 10 }, CONFIG)
  return state
}

const send = (state: SyncState, now: number, ...messages: WsMessage[]) =>
  applyEvent(state, { type: 'messages', messages, now }, CONFIG)
const tick = (state: SyncState, now: number) => applyEvent(state, { type: 'tick', now }, CONFIG)

describe('запуск и первый снимок', () => {
  it('start запрашивает снимок и не запрашивает второй раз', () => {
    const state = createSyncState()
    expect(types(applyEvent(state, { type: 'start', now: 0 }, CONFIG))).toEqual(['fetchSnapshot'])
    expect(state.phase).toBe('loading')
    expect(types(tick(state, 100))).toEqual([])
  })

  it('снимок заменяет состояние и открывает соединение с since=seq снимка', () => {
    const state = createSyncState()
    applyEvent(state, { type: 'start', now: 0 }, CONFIG)
    const effects = applyEvent(state, { type: 'snapshot', snapshot: snapshot(50), now: 20 }, CONFIG)
    expect(types(effects)).toEqual(['replace', 'openSocket'])
    expect(effects[1]).toEqual({ type: 'openSocket', since: 50, delayMs: 0 })
    expect(state).toMatchObject({ phase: 'live', hasState: true, lastSeq: 50 })
  })

  it('сообщения, пришедшие до снимка, копятся и применяются после него', () => {
    const state = createSyncState()
    applyEvent(state, { type: 'start', now: 0 }, CONFIG)
    expect(send(state, 5, data(11), data(12), data(8))).toEqual([])
    const effects = applyEvent(state, { type: 'snapshot', snapshot: snapshot(10), now: 20 }, CONFIG)
    expect(types(effects)).toEqual(['replace', 'apply', 'openSocket'])
    expect(appliedSeqs(effects)).toEqual([11, 12])
    expect(effects[2]).toMatchObject({ since: 12 })
    expect(state.lastSeq).toBe(12)
  })

  it('неожиданный снимок без запроса игнорируется', () => {
    const state = createSyncState()
    expect(applyEvent(state, { type: 'snapshot', snapshot: snapshot(5), now: 0 }, CONFIG)).toEqual([])
    expect(state.hasState).toBe(false)
  })
})

describe('порядок и повторы', () => {
  it('следующее сообщение применяется сразу', () => {
    const state = live()
    expect(appliedSeqs(send(state, 100, data(11), data(12), data(13)))).toEqual([11, 12, 13])
    expect(state.lastSeq).toBe(13)
    expect(state.stats.applied).toBe(3)
  })

  it('повтор игнорируется, состояние не меняется', () => {
    const state = live()
    send(state, 100, data(11), data(12))
    expect(send(state, 101, data(11), data(12), data(10))).toEqual([])
    expect(state.lastSeq).toBe(12)
    expect(state.stats.duplicates).toBe(3)
    expect(state.stats.applied).toBe(2)
  })

  it('повтор внутри одной пачки применяется один раз', () => {
    const state = live()
    expect(appliedSeqs(send(state, 100, data(11), data(11), data(12), data(12)))).toEqual([11, 12])
    expect(state.stats.duplicates).toBe(2)
  })

  it('перестановка в окне: 12 приходит раньше 11, оба применяются по порядку без снимка', () => {
    const state = live()
    expect(send(state, 100, data(12))).toEqual([])
    expect(state.buffer.size).toBe(1)
    expect(appliedSeqs(send(state, 200, data(11)))).toEqual([11, 12])
    expect(state.buffer.size).toBe(0)
    expect(state.gapSince).toBeNull()
    expect(tick(state, 5_000)).toEqual([])
    expect(state.stats.resyncs).toBe(0)
    expect(state.stats.reordered).toBe(1)
  })

  it('регрессия: буфер непуст постоянно, но каждая дыра короткая, снимок не нужен', () => {
    // Порядок прихода: 12, 14, 11, 16, 13, 18, 15, 20, 17, ... Новая дыра открывается раньше, чем
    // закрылась предыдущая, поэтому буфер не пустеет. Возраст дыры считается от последнего прогресса.
    const state = live()
    let t = 100
    const step = (...messages: DataMessage[]) => {
      send(state, t, ...messages)
      expect(tick(state, t)).toEqual([])
      t += 50
    }
    step(data(12))
    step(data(14))
    step(data(11)) // применены 11 и 12, в буфере 14: ждём 13
    for (let n = 13; n < 80; n += 2) {
      step(data(n + 3)) // опережающее
      step(data(n)) // недостающее: применяются n и n+1
      expect(state.buffer.size).toBe(1) // буфер не пуст ни на одном шаге
    }
    expect(t).toBeGreaterThan(1_500) // идёт заметно дольше окна перестановки
    expect(state.stats.resyncs).toBe(0)
  })

  it('длинная перестановка внутри окна собирается цепочкой', () => {
    const state = live()
    send(state, 100, data(15), data(13), data(14), data(12))
    expect(appliedSeqs(send(state, 150, data(11)))).toEqual([11, 12, 13, 14, 15])
  })

  it('повтор опережающего сообщения в буфере не дублируется', () => {
    const state = live()
    send(state, 100, data(12), data(12))
    expect(state.buffer.size).toBe(1)
    expect(state.stats.duplicates).toBe(1)
  })
})

describe('дыра', () => {
  it('потерянное сообщение: до конца окна ждём, потом запрашиваем снимок', () => {
    const state = live()
    send(state, 100, data(12), data(13))
    expect(tick(state, 599)).toEqual([])
    expect(types(tick(state, 600))).toEqual(['fetchSnapshot'])
    expect(state).toMatchObject({ phase: 'resyncing', fetching: true })
    expect(state.stats.lastResyncReason).toBe('gap')
  })

  it('после снимка из буфера применяются сообщения, следующие за ним', () => {
    const state = live()
    send(state, 100, data(12), data(13), data(15))
    tick(state, 700)
    const effects = applyEvent(state, { type: 'snapshot', snapshot: snapshot(13), now: 800 }, CONFIG)
    expect(types(effects)).toEqual(['replace', 'openSocket'])
    expect(state.lastSeq).toBe(13)
    expect([...state.buffer.keys()]).toEqual([15])
    expect(state.gapSince).not.toBeNull()
  })

  it('во время загрузки снимка новые сообщения не применяются к прежнему состоянию', () => {
    const state = live()
    send(state, 100, data(12))
    tick(state, 700)
    expect(send(state, 710, data(11), data(13))).toEqual([])
    expect(state.lastSeq).toBe(10)
    const effects = applyEvent(state, { type: 'snapshot', snapshot: snapshot(12), now: 800 }, CONFIG)
    expect(appliedSeqs(effects)).toEqual([13])
    expect(state.lastSeq).toBe(13)
  })
})

describe('хвост потока по heartbeat', () => {
  it('heartbeat опережает экран и разница не исчезает: снимок', () => {
    const state = live()
    send(state, 100, data(11), heartbeat(12))
    expect(tick(state, 300)).toEqual([])
    expect(types(tick(state, 600))).toEqual(['fetchSnapshot'])
    expect(state.stats.lastResyncReason).toBe('tail')
  })

  it('недостающее приходит в окне: снимка нет', () => {
    const state = live()
    send(state, 100, heartbeat(11))
    send(state, 300, data(11))
    expect(tick(state, 5_000)).toEqual([])
    expect(state.tailSince).toBeNull()
  })

  it('heartbeat с равным seq не вызывает снимок', () => {
    const state = live()
    send(state, 100, data(11), heartbeat(11))
    expect(tick(state, 10_000)).toEqual([])
    expect(state.stats.resyncs).toBe(0)
  })

  it('отстающий heartbeat (seq ниже применённого) безопасен', () => {
    const state = live()
    send(state, 100, data(11), data(12), heartbeat(11))
    expect(tick(state, 10_000)).toEqual([])
  })
})

describe('reset', () => {
  it('reset сразу запрашивает снимок и очищает буфер', () => {
    const state = live()
    send(state, 100, data(14))
    expect(types(send(state, 110, reset))).toEqual(['fetchSnapshot'])
    expect(state.buffer.size).toBe(0)
    expect(state.phase).toBe('resyncing')
    expect(state.stats.lastResyncReason).toBe('reset')
  })

  it('сообщения после reset копятся и применяются после снимка', () => {
    const state = live()
    send(state, 110, reset)
    expect(send(state, 120, data(21), data(22))).toEqual([])
    const effects = applyEvent(state, { type: 'snapshot', snapshot: snapshot(20), now: 200 }, CONFIG)
    expect(appliedSeqs(effects)).toEqual([21, 22])
    expect(state.lastSeq).toBe(22)
  })

  it('сервер перезапущен: снимок с меньшим seq принимается', () => {
    const state = live(500)
    send(state, 110, reset)
    applyEvent(state, { type: 'snapshot', snapshot: snapshot(3), now: 200 }, CONFIG)
    expect(state.lastSeq).toBe(3)
    expect(appliedSeqs(send(state, 300, data(4), data(5)))).toEqual([4, 5])
    expect(tick(state, 10_000)).toEqual([])
  })

  it('частые reset не вызывают лавину запросов: между снимками соблюдается пауза', () => {
    const state = live()
    send(state, 2_000, reset)
    applyEvent(state, { type: 'snapshot', snapshot: snapshot(11), now: 2_100 }, CONFIG)
    expect(send(state, 2_200, reset)).toEqual([]) // с прошлого запроса (2000) прошло меньше 1 с
    expect(types(tick(state, 2_999))).toEqual([]) // пока рано
    expect(types(tick(state, 3_000))).toEqual(['fetchSnapshot']) // пауза истекла
  })
})

describe('сеть', () => {
  it('ошибка снимка: повтор с нарастающей задержкой', () => {
    const state = createSyncState()
    applyEvent(state, { type: 'start', now: 0 }, CONFIG)
    applyEvent(state, { type: 'snapshotFailed', now: 100 }, CONFIG)
    expect(tick(state, 599)).toEqual([])
    expect(types(tick(state, 600))).toEqual(['fetchSnapshot']) // 500 мс
    applyEvent(state, { type: 'snapshotFailed', now: 700 }, CONFIG)
    expect(tick(state, 1_600)).toEqual([])
    expect(types(tick(state, 1_700))).toEqual(['fetchSnapshot']) // 1000 мс
  })

  it('задержка повтора ограничена сверху', () => {
    const state = createSyncState()
    applyEvent(state, { type: 'start', now: 0 }, CONFIG)
    for (let i = 0; i < 12; i++) {
      state.fetching = true
      applyEvent(state, { type: 'snapshotFailed', now: 0 }, CONFIG)
    }
    expect(state.fetchRetryAt).toBe(CONFIG.retryMaxMs)
  })

  it('обрыв соединения: подключение с since=lastSeq и задержкой, задержка растёт и сбрасывается данными', () => {
    const state = live(10)
    send(state, 100, data(11))
    expect(applyEvent(state, { type: 'socketClosed', now: 200 }, CONFIG)).toEqual([
      { type: 'openSocket', since: 11, delayMs: 500 },
    ])
    expect(state.phase).toBe('reconnecting')
    expect(applyEvent(state, { type: 'socketClosed', now: 800 }, CONFIG)).toEqual([
      { type: 'openSocket', since: 11, delayMs: 1_000 },
    ])
    send(state, 2_000, data(12))
    expect(state.phase).toBe('live')
    expect(applyEvent(state, { type: 'socketClosed', now: 3_000 }, CONFIG)).toEqual([
      { type: 'openSocket', since: 12, delayMs: 500 },
    ])
  })

  it('обрыв до первого снимка и во время загрузки снимка не порождает подключений', () => {
    const state = createSyncState()
    applyEvent(state, { type: 'start', now: 0 }, CONFIG)
    expect(applyEvent(state, { type: 'socketClosed', now: 10 }, CONFIG)).toEqual([])
    const live1 = live()
    send(live1, 100, reset)
    expect(applyEvent(live1, { type: 'socketClosed', now: 110 }, CONFIG)).toEqual([])
  })

  it('после обрыва сервер отвечает reset: идём за снимком', () => {
    const state = live()
    applyEvent(state, { type: 'socketClosed', now: 100 }, CONFIG)
    expect(types(send(state, 700, reset))).toEqual(['fetchSnapshot'])
  })
})

describe('защита буфера', () => {
  it('переполнение буфера в рабочем режиме вызывает снимок', () => {
    const state = createSyncState()
    const config = { ...CONFIG, maxBuffer: 5 }
    applyEvent(state, { type: 'start', now: -10_000 }, config)
    applyEvent(state, { type: 'snapshot', snapshot: snapshot(10), now: 10 }, config)
    const effects = applyEvent(state, { type: 'messages', messages: [20, 21, 22, 23, 24, 25].map(data), now: 100 }, config)
    expect(types(effects)).toEqual(['fetchSnapshot'])
    expect(state.stats.overflows).toBe(1)
    expect(state.buffer.size).toBe(0)
  })

  it('переполнение при загрузке снимка не растёт без границы', () => {
    const state = createSyncState()
    const config = { ...CONFIG, maxBuffer: 3 }
    applyEvent(state, { type: 'start', now: 0 }, config)
    applyEvent(state, { type: 'messages', messages: [1, 2, 3, 4, 5, 6, 7].map(data), now: 10 }, config)
    expect(state.buffer.size).toBeLessThanOrEqual(3)
    expect(state.stats.overflows).toBeGreaterThan(0)
  })
})
