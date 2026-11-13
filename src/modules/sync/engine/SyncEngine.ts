import type { DataMessage, DecisionMessage, PointMessage, Snapshot, WsMessage } from '@dispatch/contract'
import { columnsBuffers, FramePool, VehicleArena, type VehicleColumns } from '@/modules/vehicles'
import type { SocketHandle, SocketHandlers } from '../api/openSocket'
import { applyEvent, createSyncState, DEFAULT_SYNC_CONFIG, ServerClock, type SyncConfig, type SyncEffect, type SyncEvent } from '../core'
import type { BatchOutput, EngineOutput, StatusOutput } from '../protocol'

export interface EngineDeps {
  fetchSnapshot(): Promise<Snapshot>
  openSocket(since: number, handlers: SocketHandlers): SocketHandle
  /** Отправка пакета в основной поток; `transfer` перечисляет передаваемые буферы. */
  emit(output: EngineOutput, transfer?: ArrayBuffer[]): void
}

export interface EngineOptions {
  config?: Partial<SyncConfig>
  /** Период проверки таймеров ядра. */
  tickMs?: number
  /** Период отправки пакетов в основной поток. */
  flushMs?: number
  /** Период отправки статуса. */
  statusMs?: number
  /** Сколько кадров может быть в полёте, прежде чем новые кадры задерживаются. */
  maxFramesInFlight?: number
}

const DEFAULTS = { tickMs: 100, flushMs: 50, statusMs: 500, maxFramesInFlight: 3 }
/** Не чаще раза в это время берём замер сдвига часов из потока данных (heartbeat и снимок учитываются всегда). */
const CLOCK_SAMPLE_EVERY_MS = 500

type EntityMessage = PointMessage | DecisionMessage

/**
 * Движок синхронизации: ядро + сеть + арена машин + пакеты для основного потока.
 * Не зависит от Worker: сеть и отправка приходят как зависимости, поэтому движок проверяется в Node.
 */
export class SyncEngine {
  private readonly state = createSyncState()
  private readonly config: SyncConfig
  private readonly arena = new VehicleArena()
  private readonly pool = new FramePool()
  private readonly clock = new ServerClock()
  private readonly opts: Required<Omit<EngineOptions, 'config'>>

  private socket: SocketHandle | undefined
  private socketTimer: ReturnType<typeof setTimeout> | undefined
  private timers: Array<ReturnType<typeof setInterval>> = []
  private running = false

  // накопленное для следующего пакета
  private vehiclesDirty = false
  private replace: { points: Snapshot['points']; decisions: Snapshot['decisions'] } | undefined
  private entities = new Map<string, EntityMessage>()
  private dirty = false
  private tablesSentRevision = -1
  private framesInFlight = 0

  private lastActivityAt = 0
  private lastClockSampleAt = -Infinity

  constructor(
    private readonly deps: EngineDeps,
    options: EngineOptions = {},
  ) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...options.config }
    this.opts = { ...DEFAULTS, ...stripUndefined(options) }
  }

  get syncState() {
    return this.state
  }

  get serverClock(): ServerClock {
    return this.clock
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastActivityAt = performance.now()
    this.timers.push(setInterval(() => this.feed({ type: 'tick', now: performance.now() }), this.opts.tickMs))
    this.timers.push(setInterval(() => this.flush(), this.opts.flushMs))
    this.timers.push(setInterval(() => this.emitStatus(), this.opts.statusMs))
    this.feed({ type: 'start', now: performance.now() })
  }

  stop(): void {
    this.running = false
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    if (this.socketTimer !== undefined) clearTimeout(this.socketTimer)
    this.socketTimer = undefined
    this.socket?.close()
    this.socket = undefined
  }

  /** Основной поток вернул использованный кадр: буферы можно писать снова. */
  recycle(columns: VehicleColumns): void {
    if (this.framesInFlight > 0) this.framesInFlight -= 1
    this.pool.give(columns)
  }

  // --- события ---

  private feed(event: SyncEvent): void {
    if (!this.running) return
    const before = this.state.phase
    const effects = applyEvent(this.state, event, this.config)
    for (const effect of effects) this.execute(effect)
    if (this.state.phase !== before) this.emitStatus()
  }

  private execute(effect: SyncEffect): void {
    switch (effect.type) {
      case 'fetchSnapshot':
        this.deps.fetchSnapshot().then(
          (snapshot) => {
            // Время сервера по снимку: замер с большой задержкой, но выбор наименьшей отсеет его
            this.clock.observe(snapshot.at, Date.now())
            this.feed({ type: 'snapshot', snapshot, now: performance.now() })
          },
          () => this.feed({ type: 'snapshotFailed', now: performance.now() }),
        )
        break
      case 'openSocket':
        this.scheduleSocket(effect.since, effect.delayMs)
        break
      case 'replace':
        this.applyReplace(effect.snapshot)
        break
      case 'apply':
        this.applyMessages(effect.messages)
        break
    }
  }

  private scheduleSocket(since: number, delayMs: number): void {
    this.socket?.close()
    this.socket = undefined
    if (this.socketTimer !== undefined) clearTimeout(this.socketTimer)
    const open = () => {
      this.socketTimer = undefined
      if (!this.running) return
      const handle: SocketHandle = this.deps.openSocket(since, {
        onMessages: (messages) => {
          if (this.socket === handle) this.onMessages(messages)
        },
        onClose: () => {
          if (this.socket === handle) {
            this.socket = undefined
            this.feed({ type: 'socketClosed', now: performance.now() })
          }
        },
      })
      this.socket = handle
    }
    if (delayMs <= 0) open()
    else this.socketTimer = setTimeout(open, delayMs)
  }

  private onMessages(messages: WsMessage[]): void {
    const now = performance.now()
    this.lastActivityAt = now
    const wall = Date.now()
    let sampled = false
    for (const message of messages) {
      if (message.type === 'heartbeat') {
        this.clock.observe(message.at, wall)
        sampled = true
      }
    }
    if (!sampled && now - this.lastClockSampleAt >= CLOCK_SAMPLE_EVERY_MS) {
      const last = messages[messages.length - 1]
      if (last && last.type !== 'reset') {
        this.clock.observe(last.at, wall)
        this.lastClockSampleAt = now
      }
    }
    this.feed({ type: 'messages', messages, now })
  }

  // --- применение ---

  private applyReplace(snapshot: Snapshot): void {
    this.arena.clear()
    this.arena.upsertMany(snapshot.vehicles)
    this.vehiclesDirty = true
    // Всё накопленное до замены потеряло смысл
    this.entities.clear()
    this.replace = { points: snapshot.points, decisions: snapshot.decisions }
    this.dirty = true
  }

  private applyMessages(messages: readonly DataMessage[]): void {
    for (const message of messages) {
      if (message.type === 'vehicle') {
        this.arena.upsert(message.data)
        this.vehiclesDirty = true
      } else {
        // Последнее состояние сущности побеждает; порядок по последнему появлению сохраняется
        const id = message.type === 'point' ? `p:${message.data.point_id}` : `d:${message.data.decision_id}`
        this.entities.delete(id)
        this.entities.set(id, message)
      }
    }
    this.dirty = true
  }

  // --- пакеты ---

  /**
   * Отправляет накопленное одним пакетом. Если кадр машин задержан обратным давлением, откладывается
   * весь пакет: seq пакета всегда соответствует его содержимому, экран не заявляет о том, чего не получил.
   */
  private flush(): void {
    if (!this.dirty) return
    if (this.vehiclesDirty && this.framesInFlight >= this.opts.maxFramesInFlight) return

    const batch: BatchOutput = { type: 'batch', seq: this.state.lastSeq }
    const transfer: ArrayBuffer[] = []

    if (this.vehiclesDirty) {
      const frame = this.arena.createFrame(this.pool.take(this.arena.count))
      batch.vehicles = { frame }
      if (this.arena.tablesRevision !== this.tablesSentRevision) {
        batch.vehicles.tables = { ids: [...this.arena.ids], names: [...this.arena.names], points: [...this.arena.points] }
        this.tablesSentRevision = this.arena.tablesRevision
      }
      transfer.push(...columnsBuffers(frame.columns))
      this.framesInFlight += 1
      this.vehiclesDirty = false
    }

    if (this.replace !== undefined || this.entities.size > 0) {
      const entities: NonNullable<BatchOutput['entities']> = { messages: [...this.entities.values()] }
      if (this.replace !== undefined) entities.replace = this.replace
      batch.entities = entities
      this.replace = undefined
      this.entities.clear()
    }

    this.dirty = false
    this.deps.emit(batch, transfer)
  }

  private emitStatus(): void {
    const status: StatusOutput = {
      type: 'status',
      phase: this.state.phase,
      seq: this.state.lastSeq,
      offsetMs: this.clock.offsetMs,
      synced: this.clock.synced,
      idleMs: Math.max(0, performance.now() - this.lastActivityAt),
      snapshots: this.state.snapshotsLoaded,
      stats: { ...this.state.stats },
    }
    this.deps.emit(status)
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}
