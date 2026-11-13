import type { Decision, Point, QueueItem, Vehicle } from '@dispatch/contract'
import type { MockConfig } from './config'
import { createRng } from './random'
import { iso, type Clock } from './time'
import type { World } from './world'

type Phase = 'to_point' | 'queued' | 'service' | 'loaded' | 'hold'

interface Mover {
  index: number
  v: Vehicle
  phase: Phase
  fromX: number
  fromY: number
  toX: number
  toY: number
  startAt: number
  arriveAt: number
  speedMs: number
  target: string
  arrivedAt: number
  serviceEnd: number
  serviceMs: number
  holdUntil: number
  holdState: 'idle' | 'offline'
  /** Машина из «молчащей» группы (FAULTS=stale). */
  staleGroup: boolean
  staleOffset: number
  /** Когда машина должна обновиться в следующий раз: ровно раз в секунду, со сдвигом между машинами. */
  nextUpdateAt: number
}

interface PointRuntime {
  point: Point
  bays: number
  enroute: Set<Mover>
  fifo: Mover[]
  serving: Set<Mover>
  dirty: boolean
  queueJson: string
  recomputedAt: number
}

export const SITE_WIDTH_M = 6000
export const SITE_HEIGHT_M = 4000
const DUMP = { x: 300, y: 3700 }
const QUEUE_LIMIT = 20
const POINT_SPOTS = [
  { x: 800, y: 700 },
  { x: 3120, y: 900 },
  { x: 5200, y: 1100 },
  { x: 1000, y: 2900 },
  { x: 3000, y: 3200 },
  { x: 5000, y: 2800 },
]

const round1 = (n: number) => Math.round(n * 10) / 10

function plural(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'машина'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'машины'
  return 'машин'
}

/** Спецсимволы в reason: проверка, что экран выводит его как текст. */
const SPECIAL_REASONS = [
  ' <img src=x onerror=alert(1)> & "кавычки" \'апострофы\' 😀',
  ' </li><script>alert("xss")</script> {{ 1 + 1 }} ${1+1}',
  ' строка 1\nстрока 2 ‮ обратный порядок',
]

export interface SimStats {
  emitted: number
  maxTickMs: number
}

/**
 * Простая симуляция: машины ездят между пунктами, у пунктов есть очередь,
 * система создаёт решения о перенаправлении. Правдоподобие не оценивается.
 * Время передаётся снаружи (tick(now)), поэтому тесты управляют часами сами.
 */
export class Simulation {
  readonly stats: SimStats = { emitted: 0, maxTickMs: 0 }

  private readonly rng: () => number
  private readonly movers: Mover[] = []
  private readonly points = new Map<string, PointRuntime>()
  private readonly pendingByVehicle = new Set<string>()
  private readonly slices: number
  private readonly startedAt: number
  private nextDecisionAt = 0
  private decisionCounter = 0
  private nextPruneAt = 0
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly world: World,
    private readonly config: MockConfig,
    private readonly clock: Clock,
  ) {
    this.rng = createRng(config.seed + 1000)
    this.slices = Math.max(1, Math.round(1000 / config.tickMs))
    const now = clock()
    this.startedAt = now
    this.nextDecisionAt = now + this.randomBetween(config.decisionMinMs, config.decisionMaxMs)
    this.nextPruneAt = now + 60_000
    this.createPoints(now)
    this.createVehicles(now)
  }

  start(): void {
    this.timer = setInterval(() => this.tick(this.clock()), this.config.tickMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /** Один шаг симуляции. Публичный, чтобы тесты вызывали его с управляемым временем. */
  tick(now: number): void {
    const began = performance.now()
    this.processDecisions(now)
    this.processServices(now)
    this.updateSlice(now)
    this.createDecisionIfDue(now)
    this.recomputeQueues(now)
    if (now >= this.nextPruneAt) {
      this.world.pruneDecisions()
      this.nextPruneAt = now + 60_000
    }
    const took = performance.now() - began
    if (took > this.stats.maxTickMs) this.stats.maxTickMs = took
  }

  /** Исполняет решения, срок которых наступил. Вызывается и перед обработкой команд. */
  processDecisions(now: number): void {
    for (const decision of this.world.decisions.values()) {
      if (decision.status === 'pending' && Date.parse(decision.execute_at) <= now) {
        this.executeDecision(decision, now)
      }
    }
  }

  /** Отменяет ожидающее решение. Возвращает обновлённое решение. */
  cancelDecision(decision: Decision): Decision {
    decision.status = 'cancelled'
    decision.version += 1
    this.pendingByVehicle.delete(decision.vehicle_id)
    this.world.emit('decision', decision)
    return decision
  }

  setPointMode(pointId: string, mode: Point['mode']): Point | undefined {
    const runtime = this.points.get(pointId)
    if (!runtime) return undefined
    if (runtime.point.mode !== mode) {
      runtime.point.mode = mode
      runtime.point.version += 1
      this.world.emit('point', runtime.point)
    }
    return runtime.point
  }

  /** Принудительная перерисовка очередей (для тестов). */
  flushQueues(now: number): void {
    for (const runtime of this.points.values()) runtime.dirty = true
    this.recomputeQueues(now, true)
  }

  // --- создание ---

  private createPoints(now: number): void {
    const bays = Math.max(1, Math.ceil(this.config.load / 150))
    POINT_SPOTS.forEach((spot, i) => {
      const point: Point = {
        point_id: `p-${i + 1}`,
        name: `Пункт ${i + 1}`,
        x_m: spot.x,
        y_m: spot.y,
        mode: 'auto',
        version: 1,
        queue: [],
      }
      this.world.points.set(point.point_id, point)
      this.points.set(point.point_id, {
        point,
        bays,
        enroute: new Set(),
        fifo: [],
        serving: new Set(),
        dirty: true,
        queueJson: '[]',
        recomputedAt: now,
      })
    })
  }

  private createVehicles(now: number): void {
    const staleCycle = this.config.staleSilentMs + this.config.staleActiveMs
    for (let i = 0; i < this.config.load; i++) {
      const number = i + 1
      const id = `v-${String(number).padStart(2, '0')}`
      const v: Vehicle = {
        vehicle_id: id,
        name: `Т-${String(number).padStart(2, '0')}`,
        x_m: round1(this.rng() * SITE_WIDTH_M),
        y_m: round1(this.rng() * SITE_HEIGHT_M),
        heading_deg: 0,
        speed_kmh: 0,
        state: 'moving_empty',
        point_id: 'p-1',
        last_seen: iso(now),
      }
      const mover: Mover = {
        index: i,
        v,
        phase: 'to_point',
        fromX: v.x_m,
        fromY: v.y_m,
        toX: v.x_m,
        toY: v.y_m,
        startAt: now,
        arriveAt: now,
        speedMs: 0,
        target: 'p-1',
        arrivedAt: 0,
        serviceEnd: 0,
        serviceMs: 0,
        holdUntil: 0,
        holdState: 'idle',
        staleGroup: i % 5 === 0,
        staleOffset: Math.floor((i / 5) * 997) % staleCycle,
        nextUpdateAt: now + (i % this.slices) * this.config.tickMs,
      }
      this.movers.push(mover)
      this.world.vehicles.set(id, v)
      this.sendToPoint(mover, this.pickPoint(), now, true)
      // Машины стартуют в разных местах пути, а не все разом из точки появления
      const progress = this.rng()
      mover.startAt = now - Math.floor((mover.arriveAt - now) * progress)
      this.applyPublic(mover, now)
    }
  }

  // --- движение ---

  private updateSlice(now: number): void {
    for (const mover of this.movers) {
      if (mover.nextUpdateAt > now) continue
      // Период ровно 1 с; если шаг сильно запоздал, не накапливаем долг
      mover.nextUpdateAt = now - mover.nextUpdateAt > 1000 ? now + 1000 : mover.nextUpdateAt + 1000
      this.updateMover(mover, now)
    }
  }

  private updateMover(mover: Mover, now: number): void {
    switch (mover.phase) {
      case 'to_point':
        if (now >= mover.arriveAt) {
          this.arrive(mover, now)
          return
        }
        break
      case 'loaded':
        if (now >= mover.arriveAt) {
          this.afterDump(mover, now)
          return
        }
        break
      case 'hold':
        if (now >= mover.holdUntil) {
          this.sendToPoint(mover, this.pickPoint(), now)
          return
        }
        break
      default:
        break
    }
    this.touch(mover, now)
  }

  private arrive(mover: Mover, now: number): void {
    const runtime = this.points.get(mover.target)
    if (!runtime) return
    runtime.enroute.delete(mover)
    runtime.dirty = true
    mover.fromX = mover.toX
    mover.fromY = mover.toY
    mover.arrivedAt = now
    if (runtime.serving.size < runtime.bays && runtime.fifo.length === 0) {
      this.startService(mover, runtime, now)
    } else {
      mover.phase = 'queued'
      runtime.fifo.push(mover)
      this.touch(mover, now)
    }
  }

  private startService(mover: Mover, runtime: PointRuntime, now: number): void {
    mover.phase = 'service'
    mover.serviceMs = this.randomBetween(this.config.serviceMinMs, this.config.serviceMaxMs)
    mover.serviceEnd = now + mover.serviceMs
    runtime.serving.add(mover)
    runtime.dirty = true
    this.touch(mover, now)
  }

  private processServices(now: number): void {
    for (const runtime of this.points.values()) {
      for (const mover of runtime.serving) {
        if (now < mover.serviceEnd) continue
        runtime.serving.delete(mover)
        runtime.dirty = true
        mover.phase = 'loaded'
        mover.fromX = runtime.point.x_m
        mover.fromY = runtime.point.y_m
        mover.toX = DUMP.x
        mover.toY = DUMP.y
        mover.speedMs = this.randomBetween(11_000, 16_000) / 1000
        mover.startAt = now
        mover.arriveAt = now + this.travelMs(mover)
        this.touch(mover, now)
      }
      while (runtime.serving.size < runtime.bays && runtime.fifo.length > 0) {
        const next = runtime.fifo.shift()
        if (next) this.startService(next, runtime, now)
      }
    }
  }

  private afterDump(mover: Mover, now: number): void {
    const roll = this.rng()
    mover.fromX = mover.toX
    mover.fromY = mover.toY
    if (roll < 0.13) {
      mover.phase = 'hold'
      mover.holdState = roll < 0.1 ? 'idle' : 'offline'
      mover.holdUntil = now + (roll < 0.1 ? this.randomBetween(5_000, 10_000) : this.randomBetween(15_000, 25_000))
      this.touch(mover, now)
      return
    }
    this.sendToPoint(mover, this.pickPoint(), now)
  }

  /** Отправляет машину к пункту: считает путь и время прибытия. */
  private sendToPoint(mover: Mover, pointId: string, now: number, silent = false): void {
    const runtime = this.points.get(pointId)
    if (!runtime) return
    const [x, y] = this.position(mover, now)
    this.detach(mover)
    mover.phase = 'to_point'
    mover.target = pointId
    mover.fromX = x
    mover.fromY = y
    mover.toX = runtime.point.x_m
    mover.toY = runtime.point.y_m
    mover.speedMs = this.randomBetween(11_000, 16_000) / 1000
    mover.startAt = now
    mover.arriveAt = now + this.travelMs(mover)
    runtime.enroute.add(mover)
    runtime.dirty = true
    if (!silent) this.touch(mover, now)
  }

  /** Убирает машину из структур пункта, к которому она была привязана. */
  private detach(mover: Mover): void {
    const runtime = this.points.get(mover.target)
    if (!runtime) return
    runtime.enroute.delete(mover)
    runtime.serving.delete(mover)
    const at = runtime.fifo.indexOf(mover)
    if (at >= 0) runtime.fifo.splice(at, 1)
    runtime.dirty = true
  }

  private pickPoint(): string {
    const free = [...this.points.values()].filter((r) => r.point.mode === 'auto')
    const pool = free.length > 0 ? free : [...this.points.values()]
    const chosen = pool[Math.floor(this.rng() * pool.length)]
    return chosen ? chosen.point.point_id : 'p-1'
  }

  private travelMs(mover: Mover): number {
    const distance = Math.hypot(mover.toX - mover.fromX, mover.toY - mover.fromY)
    return Math.max(1000, Math.round((distance / mover.speedMs) * 1000))
  }

  private position(mover: Mover, now: number): [number, number] {
    if (mover.phase !== 'to_point' && mover.phase !== 'loaded') return [mover.fromX, mover.fromY]
    const span = mover.arriveAt - mover.startAt
    const f = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - mover.startAt) / span))
    return [mover.fromX + (mover.toX - mover.fromX) * f, mover.fromY + (mover.toY - mover.fromY) * f]
  }

  // --- публичный вид машины ---

  private isSilent(mover: Mover, now: number): boolean {
    if (!this.config.faults.has('stale') || !mover.staleGroup) return false
    const cycle = this.config.staleSilentMs + this.config.staleActiveMs
    return (now - this.startedAt + mover.staleOffset) % cycle < this.config.staleSilentMs
  }

  /** Обновляет публичный объект и отправляет событие. Молчащая машина не обновляется вовсе. */
  private touch(mover: Mover, now: number): void {
    if (this.isSilent(mover, now)) return
    this.applyPublic(mover, now)
    this.world.emit('vehicle', mover.v)
    this.stats.emitted += 1
  }

  private applyPublic(mover: Mover, now: number): void {
    const v = mover.v
    const moving = mover.phase === 'to_point' || mover.phase === 'loaded'
    const [x, y] = this.position(mover, now)
    if (moving) {
      const dx = mover.toX - mover.fromX
      const dy = mover.toY - mover.fromY
      if (dx !== 0 || dy !== 0) v.heading_deg = Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360)
    }
    v.x_m = round1(x)
    v.y_m = round1(y)
    v.speed_kmh = moving ? round1(mover.speedMs * 3.6) : 0
    v.state = this.stateOf(mover)
    v.point_id = mover.target
    v.last_seen = iso(now)
  }

  private stateOf(mover: Mover): Vehicle['state'] {
    switch (mover.phase) {
      case 'to_point':
        return 'moving_empty'
      case 'queued':
        return 'queued'
      case 'service':
        return 'service'
      case 'loaded':
        return 'moving_loaded'
      case 'hold':
        return mover.holdState
    }
  }

  // --- очереди ---

  private recomputeQueues(now: number, force = false): void {
    for (const runtime of this.points.values()) {
      if (!runtime.dirty) continue
      if (!force && now - runtime.recomputedAt < this.config.queueRecomputeMs) continue
      runtime.dirty = false
      runtime.recomputedAt = now
      const queue = this.buildQueue(runtime, now)
      const json = JSON.stringify(queue)
      if (json === runtime.queueJson) continue
      runtime.queueJson = json
      runtime.point.queue = queue
      runtime.point.version += 1
      this.world.emit('point', runtime.point)
    }
  }

  /** Очередь считает сервер: экран показывает значения как есть. */
  private buildQueue(runtime: PointRuntime, now: number): QueueItem[] {
    const items: Array<{ mover: Mover; eta: number }> = []
    for (const mover of runtime.enroute) items.push({ mover, eta: mover.arriveAt })
    for (const mover of runtime.fifo) items.push({ mover, eta: mover.arrivedAt })
    items.sort((a, b) => a.eta - b.eta || a.mover.index - b.mover.index)

    const free: number[] = []
    for (const mover of runtime.serving) free.push(mover.serviceEnd)
    while (free.length < runtime.bays) free.push(now)

    const queue: QueueItem[] = []
    for (const { mover, eta } of items.slice(0, QUEUE_LIMIT)) {
      let bay = 0
      for (let i = 1; i < free.length; i++) {
        if ((free[i] ?? Infinity) < (free[bay] ?? Infinity)) bay = i
      }
      const serviceMs = (this.config.serviceMinMs + this.config.serviceMaxMs) / 2
      const start = Math.max(eta, free[bay] ?? now, now)
      free[bay] = start + serviceMs
      queue.push({
        vehicle_id: mover.v.vehicle_id,
        eta: iso(eta),
        service_start: iso(start),
        wait_s: Math.round((start - eta) / 1000),
      })
    }
    return queue
  }

  // --- решения ---

  private createDecisionIfDue(now: number): void {
    if (now < this.nextDecisionAt) return
    this.nextDecisionAt = now + this.randomBetween(this.config.decisionMinMs, this.config.decisionMaxMs)
    const auto = [...this.points.values()].filter((r) => r.point.mode === 'auto')
    if (auto.length < 2) return

    const length = (r: PointRuntime) => r.enroute.size + r.fifo.length
    const sorted = [...auto].sort((a, b) => length(b) - length(a))
    const from = sorted[0]
    const to = sorted[sorted.length - 1]
    if (!from || !to || from === to) return

    const candidates = from.point.queue.filter((item) => !this.pendingByVehicle.has(item.vehicle_id))
    const item = candidates[Math.floor(this.rng() * candidates.length)]
    if (!item) return

    const toTail = to.point.queue[to.point.queue.length - 1]
    const gain = Math.max(10, item.wait_s - (toTail ? toTail.wait_s : 0))
    const fromCount = length(from)
    const toCount = length(to)
    let reason =
      `Очередь на ${from.point.name} — ${fromCount} ${plural(fromCount)}, ` +
      (toCount === 0 ? `${to.point.name} свободен` : `на ${to.point.name} ${toCount} ${plural(toCount)}`)
    this.decisionCounter += 1
    if (this.decisionCounter % 4 === 0) {
      reason += SPECIAL_REASONS[(this.decisionCounter / 4 - 1) % SPECIAL_REASONS.length] ?? ''
    }

    const decision: Decision = {
      decision_id: `d-${3380 + this.decisionCounter}`,
      vehicle_id: item.vehicle_id,
      from_point: from.point.point_id,
      to_point: to.point.point_id,
      gain_s: gain,
      reason,
      status: 'pending',
      created_at: iso(now),
      execute_at: iso(now + this.config.executeAfterMs),
      version: 1,
    }
    this.world.decisions.set(decision.decision_id, decision)
    this.pendingByVehicle.add(decision.vehicle_id)
    this.world.emit('decision', decision)
  }

  private executeDecision(decision: Decision, now: number): void {
    this.pendingByVehicle.delete(decision.vehicle_id)
    const mover = this.movers.find((m) => m.v.vehicle_id === decision.vehicle_id)
    const stillWaiting =
      mover !== undefined &&
      mover.target === decision.from_point &&
      (mover.phase === 'to_point' || mover.phase === 'queued')
    if (mover && stillWaiting) {
      decision.status = 'executed'
      decision.version += 1
      this.world.emit('decision', decision)
      this.sendToPoint(mover, decision.to_point, now)
    } else {
      decision.status = 'expired'
      decision.version += 1
      this.world.emit('decision', decision)
    }
  }

  private randomBetween(min: number, max: number): number {
    return Math.round(min + this.rng() * Math.max(0, max - min))
  }
}
