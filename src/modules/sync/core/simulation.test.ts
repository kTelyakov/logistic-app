import type { DataMessage, WsMessage } from '@dispatch/contract'
import { describe, expect, it } from 'vitest'
import { applyEvent, createSyncState } from './applyEvent'
import { DEFAULT_SYNC_CONFIG, type SyncEffect, type SyncEvent } from './types'

/** Генератор (mulberry32): прогоны воспроизводимы по seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Минимальная куча событий: порядок по времени, при равенстве по порядку добавления. */
class EventQueue {
  private readonly items: Array<{ at: number; order: number; run: () => void }> = []
  private counter = 0

  get size(): number {
    return this.items.length
  }

  push(at: number, run: () => void): void {
    const items = this.items
    items.push({ at, order: this.counter++, run })
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.less(parent, i)) break
      this.swap(parent, i)
      i = parent
    }
  }

  pop(): { at: number; run: () => void } | undefined {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (top === undefined || last === undefined) return top
    if (items.length > 0) {
      items[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        const right = left + 1
        let smallest = i
        if (left < items.length && this.less(left, smallest)) smallest = left
        if (right < items.length && this.less(right, smallest)) smallest = right
        if (smallest === i) break
        this.swap(i, smallest)
        i = smallest
      }
    }
    return top
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a]!
    const y = this.items[b]!
    return x.at < y.at || (x.at === y.at && x.order < y.order)
  }

  private swap(a: number, b: number): void {
    const items = this.items
    ;[items[a], items[b]] = [items[b]!, items[a]!]
  }
}

interface Profile {
  drop: number
  dup: number
  /** Вероятность, что сообщение задержится (перестановка). */
  late: number
  /** Максимальная задержка перестановки, мс. Больше окна (500) означает потерю для ядра. */
  lateMax: number
  socketCloseEveryMs: number
  resetEveryMs: number
  snapshotFail: number
  journalSize: number
}

const PROFILES: Record<string, Profile> = {
  чистая: { drop: 0, dup: 0, late: 0, lateMax: 0, socketCloseEveryMs: 0, resetEveryMs: 0, snapshotFail: 0, journalSize: 10_000 },
  'пропуски': { drop: 0.05, dup: 0, late: 0, lateMax: 0, socketCloseEveryMs: 0, resetEveryMs: 0, snapshotFail: 0, journalSize: 10_000 },
  'повторы и перестановки': { drop: 0, dup: 0.1, late: 0.15, lateMax: 300, socketCloseEveryMs: 0, resetEveryMs: 0, snapshotFail: 0, journalSize: 10_000 },
  'всё вместе': { drop: 0.03, dup: 0.05, late: 0.1, lateMax: 900, socketCloseEveryMs: 0, resetEveryMs: 0, snapshotFail: 0, journalSize: 10_000 },
  'обрывы и reset': { drop: 0.01, dup: 0.03, late: 0.05, lateMax: 300, socketCloseEveryMs: 4_000, resetEveryMs: 7_000, snapshotFail: 0.2, journalSize: 10_000 },
  'малый журнал': { drop: 0.02, dup: 0.02, late: 0.05, lateMax: 300, socketCloseEveryMs: 3_000, resetEveryMs: 0, snapshotFail: 0.1, journalSize: 40 },
}

interface Run {
  serverSeq: number
  clientSeq: number
  /** Значение, которое клиент «показывает»: seq последнего применённого изменения. */
  shown: number
  resyncs: number
  duplicates: number
  snapshots: number
  violations: string[]
}

/**
 * Дискретная симуляция сети между сервером и ядром. Оболочка исполняет эффекты ядра так,
 * как это делают воркер и заглушка: снимок, подключение с since, реплей из журнала, reset.
 */
function simulate(seed: number, profile: Profile): Run {
  const random = rng(seed)
  const MESSAGE_EVERY_MS = 10
  const SEND_UNTIL_MS = 20_000
  const END_MS = SEND_UNTIL_MS + 30_000
  const config = DEFAULT_SYNC_CONFIG

  const state = createSyncState()
  const queue = new EventQueue()
  const at = (t: number, run: () => void) => queue.push(t, run)

  let now = 0
  let serverSeq = 0
  let generation = 0 // номер текущего соединения; сообщения старых соединений не пропадают, но идут своим чередом
  let socketOpen = false
  let shown = 0
  let lastApplied = 0
  const violations: string[] = []

  const dataMessage = (seq: number): DataMessage => ({
    seq,
    at: '2026-10-01T04:00:00Z',
    type: 'vehicle',
    data: { vehicle_id: 'v-1', name: 'Т-1', x_m: seq, y_m: 0, heading_deg: 0, speed_kmh: 0, state: 'idle', point_id: 'p-1', last_seen: '2026-10-01T04:00:00Z' },
  })

  const deliver = (messages: WsMessage[]) => feed({ type: 'messages', messages, now })

  /** Сеть: пропуск, повтор, перестановка. */
  function transmit(message: WsMessage, gen: number, faulty = true) {
    if (faulty && random() < profile.drop) return
    const copies = faulty && random() < profile.dup ? 2 : 1
    for (let i = 0; i < copies; i++) {
      const extra = faulty && random() < profile.late ? random() * profile.lateMax : 0
      const delay = 5 + random() * 40 + extra
      at(now + delay, () => {
        if (gen === generation && !socketOpen && message.type !== 'reset') return // соединение закрыто: в пути пропало
        deliver([message])
      })
    }
  }

  function execute(effects: SyncEffect[]) {
    for (const effect of effects) {
      switch (effect.type) {
        case 'fetchSnapshot': {
          const latency = 20 + random() * 200
          if (random() < profile.snapshotFail) {
            at(now + latency, () => feed({ type: 'snapshotFailed', now }))
          } else {
            // Сервер формирует снимок в середине запроса
            at(now + latency / 2, () => {
              const seq = serverSeq
              at(now + latency / 2, () =>
                feed({ type: 'snapshot', snapshot: { seq, at: '2026-10-01T04:00:00Z', vehicles: [], points: [], decisions: [] }, now }),
              )
            })
          }
          break
        }
        case 'openSocket': {
          const { since, delayMs } = effect
          at(now + delayMs, () => {
            generation += 1
            const gen = generation
            socketOpen = true
            // Журнал заглушки ограничен: если since слишком старый, сервер отвечает reset
            if (since > serverSeq || serverSeq - since > profile.journalSize) {
              transmit({ type: 'reset' }, gen, false)
              return
            }
            for (let seq = since + 1; seq <= serverSeq; seq++) transmit(dataMessage(seq), gen)
          })
          break
        }
        case 'replace':
          shown = effect.snapshot.seq
          lastApplied = effect.snapshot.seq
          break
        case 'apply':
          for (const message of effect.messages) {
            if (message.seq !== lastApplied + 1) violations.push(`применён seq=${message.seq} после ${lastApplied}`)
            lastApplied = message.seq
            shown = message.seq
          }
          break
      }
    }
  }

  function feed(event: SyncEvent) {
    execute(applyEvent(state, event, config))
  }

  // сервер
  for (let t = MESSAGE_EVERY_MS; t <= SEND_UNTIL_MS; t += MESSAGE_EVERY_MS) {
    at(t, () => {
      serverSeq += 1
      if (socketOpen) transmit(dataMessage(serverSeq), generation)
    })
  }
  for (let t = 1_000; t <= END_MS; t += 1_000) {
    at(t, () => {
      if (socketOpen) transmit({ type: 'heartbeat', seq: serverSeq, at: '2026-10-01T04:00:00Z' }, generation, false)
    })
  }
  // внешние события
  if (profile.socketCloseEveryMs > 0) {
    for (let t = profile.socketCloseEveryMs; t < SEND_UNTIL_MS; t += profile.socketCloseEveryMs) {
      at(t + random() * 500, () => {
        socketOpen = false
        feed({ type: 'socketClosed', now })
      })
    }
  }
  if (profile.resetEveryMs > 0) {
    for (let t = profile.resetEveryMs; t < SEND_UNTIL_MS; t += profile.resetEveryMs) {
      at(t, () => {
        if (socketOpen) transmit({ type: 'reset' }, generation, false)
      })
    }
  }
  for (let t = 100; t <= END_MS; t += 100) at(t, () => feed({ type: 'tick', now }))

  feed({ type: 'start', now: 0 })

  // ход времени
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (next.at > END_MS) break
    now = next.at
    next.run()
  }

  return {
    serverSeq,
    clientSeq: state.lastSeq,
    shown,
    resyncs: state.stats.resyncs,
    duplicates: state.stats.duplicates,
    snapshots: state.snapshotsLoaded,
    violations,
  }
}

describe('ядро сходится к состоянию сервера при отказах сети', () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    it(`профиль «${name}»: 60 прогонов`, () => {
      let totalResyncs = 0
      let totalDuplicates = 0
      for (let seed = 1; seed <= 60; seed++) {
        const run = simulate(seed * 7919, profile)
        const where = `seed=${seed * 7919}`
        expect(run.violations, `${where}: порядок применения`).toEqual([])
        expect(run.serverSeq, `${where}: сервер отправил`).toBe(2_000)
        expect(run.clientSeq, `${where}: seq клиента`).toBe(run.serverSeq)
        expect(run.shown, `${where}: показанное значение`).toBe(run.serverSeq)
        totalResyncs += run.resyncs
        totalDuplicates += run.duplicates
      }
      if (name === 'чистая') expect(totalResyncs).toBe(0)
      if (name === 'пропуски' || name === 'всё вместе') expect(totalResyncs).toBeGreaterThan(0)
      if (profile.dup > 0) expect(totalDuplicates).toBeGreaterThan(0)
    })
  }

  it('перестановки в пределах окна не вызывают лишних снимков', () => {
    let resyncs = 0
    for (let seed = 1; seed <= 40; seed++) {
      resyncs += simulate(seed * 31, { ...PROFILES['повторы и перестановки']! }).resyncs
    }
    expect(resyncs).toBe(0)
  })
})
